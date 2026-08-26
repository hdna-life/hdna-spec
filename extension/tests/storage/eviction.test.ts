import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { evictIfNeeded, planEviction } from '../../src/storage/eviction';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import type { StorageRecordMeta } from '../../src/storage/types';
import type { StoragePolicy } from '@spec/schema/storage-policy';

function record(overrides: Partial<StorageRecordMeta>): StorageRecordMeta {
  return { store: 's', key: 'k', storageClass: 'CACHE', size: 10, ...overrides };
}

describe('planEviction', () => {
  it('plans nothing when under budget', () => {
    const policy: StoragePolicy = { maxTotalBytes: 100 };
    const plan = planEviction([record({ size: 50 })], 50, policy);
    expect(plan).toEqual({ toDelete: [], bytesFreed: 0, remainingBytes: 50 });
  });

  it('evicts CACHE before DERIVED before RAW', () => {
    const policy: StoragePolicy = { maxTotalBytes: 10 };
    const records = [
      record({ key: 'raw-1', storageClass: 'RAW', size: 10 }),
      record({ key: 'derived-1', storageClass: 'DERIVED', size: 10 }),
      record({ key: 'cache-1', storageClass: 'CACHE', size: 10 }),
    ];
    const plan = planEviction(records, 30, policy);

    // Evicting just CACHE (10 bytes) brings total to 20, still over budget (10);
    // evicting DERIVED too brings it to 10, which satisfies <= 10.
    expect(plan.toDelete.map((r) => r.key)).toEqual(['cache-1', 'derived-1']);
    expect(plan.remainingBytes).toBe(10);
    expect(plan.bytesFreed).toBe(20);
  });

  it('never evicts CANONICAL, even if that means staying over budget', () => {
    const policy: StoragePolicy = { maxTotalBytes: 5 };
    const records = [record({ key: 'evidence', storageClass: 'CANONICAL', size: 20 })];
    const plan = planEviction(records, 20, policy);

    expect(plan.toDelete).toEqual([]);
    expect(plan.remainingBytes).toBe(20);
  });

  it('stops as soon as the budget is satisfied, without over-evicting', () => {
    const policy: StoragePolicy = { maxTotalBytes: 15 };
    const records = [
      record({ key: 'cache-1', storageClass: 'CACHE', size: 10 }),
      record({ key: 'cache-2', storageClass: 'CACHE', size: 10 }),
    ];
    const plan = planEviction(records, 20, policy);

    expect(plan.toDelete.map((r) => r.key)).toEqual(['cache-1']);
    expect(plan.remainingBytes).toBe(10);
  });
});

describe('evictIfNeeded', () => {
  it('does nothing when storage is under budget', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    await storage.put('s', 'k', { text: 'small' }, 'CACHE');

    const plan = await evictIfNeeded(storage, { maxTotalBytes: 1_000_000 });
    expect(plan.toDelete).toEqual([]);
    await expect(storage.get('s', 'k')).resolves.toEqual({ text: 'small' });
  });

  it('deletes CACHE records from real storage when over budget, preserving CANONICAL', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    await storage.put('evidence', 'e1', { text: 'must survive' }, 'CANONICAL');
    await storage.put('cache', 'c1', { text: 'x'.repeat(200) }, 'CACHE');

    const usageBefore = await storage.usageByClass();
    const total = Object.values(usageBefore).reduce((a, b) => a + b, 0);

    const plan = await evictIfNeeded(storage, { maxTotalBytes: usageBefore.CANONICAL });
    expect(plan.bytesFreed).toBeGreaterThan(0);
    expect(plan.remainingBytes).toBeLessThan(total);

    await expect(storage.get('evidence', 'e1')).resolves.toEqual({ text: 'must survive' });
    await expect(storage.get('cache', 'c1')).resolves.toBeUndefined();
  });
});
