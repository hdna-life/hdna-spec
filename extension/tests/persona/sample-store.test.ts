import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { WritingSampleStore } from '../../src/persona/sample-store';

describe('WritingSampleStore', () => {
  it('adds and lists samples', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new WritingSampleStore(storage);

    await store.addSample('first sample');
    await store.addSample('second sample', { surface: 'chat' });

    const samples = await store.list();
    expect(samples.map((s) => s.text).sort()).toEqual(['first sample', 'second sample']);
  });

  it('gets a sample by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new WritingSampleStore(storage);
    const sample = await store.addSample('find me', { surface: 'chat' });

    await expect(store.get(sample.id)).resolves.toEqual(sample);
  });

  it('returns undefined for an unknown id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new WritingSampleStore(storage);
    await expect(store.get('missing')).resolves.toBeUndefined();
  });

  it('persists samples across store instances backed by the same storage', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const storeA = new WritingSampleStore(storage);
    await storeA.addSample('persisted sample');

    const storeB = new WritingSampleStore(storage);
    const samples = await storeB.list();
    expect(samples).toHaveLength(1);
    expect(samples[0].text).toBe('persisted sample');
  });

  it('stores samples as CANONICAL', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new WritingSampleStore(storage);
    await store.addSample('sample');

    const usage = await storage.usageByClass();
    expect(usage.CANONICAL).toBeGreaterThan(0);
  });
});
