import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { RuntimeStatusStore } from '../../src/runtime/status';

describe('RuntimeStatusStore', () => {
  it('returns undefined before any status is set', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new RuntimeStatusStore(storage);
    await expect(store.get()).resolves.toBeUndefined();
  });

  it('round-trips a status through set/get', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new RuntimeStatusStore(storage);
    const status = { mode: 'BACKGROUND' as const, batchSize: 8, updatedAt: '2026-01-01T00:00:00.000Z' };

    await store.set(status);
    await expect(store.get()).resolves.toEqual(status);
  });

  it('stores status as CACHE', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new RuntimeStatusStore(storage);
    await store.set({ mode: 'DEEP_IDLE', batchSize: 4, updatedAt: '2026-01-01T00:00:00.000Z' });

    const usage = await storage.usageByClass();
    expect(usage.CACHE).toBeGreaterThan(0);
  });
});
