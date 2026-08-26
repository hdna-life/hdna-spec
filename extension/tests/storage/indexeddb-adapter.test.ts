import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';

describe('IndexedDbStorageAdapter', () => {
  let dbName: string;

  beforeEach(() => {
    dbName = `hdna-test-${Math.random()}`;
  });

  it('round-trips a value through put/get', async () => {
    const adapter = new IndexedDbStorageAdapter(dbName);
    await adapter.put('events', 'evt-1', { text: 'hello' }, 'CANONICAL');
    await expect(adapter.get('events', 'evt-1')).resolves.toEqual({ text: 'hello' });
  });

  it('returns undefined for missing keys', async () => {
    const adapter = new IndexedDbStorageAdapter(dbName);
    await expect(adapter.get('events', 'missing')).resolves.toBeUndefined();
  });

  it('deletes a value', async () => {
    const adapter = new IndexedDbStorageAdapter(dbName);
    await adapter.put('events', 'evt-1', { text: 'hello' }, 'CANONICAL');
    await adapter.delete('events', 'evt-1');
    await expect(adapter.get('events', 'evt-1')).resolves.toBeUndefined();
  });

  it('queries all values in a store, scoped by store name', async () => {
    const adapter = new IndexedDbStorageAdapter(dbName);
    await adapter.put('events', 'evt-1', { n: 1 }, 'CANONICAL');
    await adapter.put('events', 'evt-2', { n: 2 }, 'CANONICAL');
    await adapter.put('other', 'evt-1', { n: 99 }, 'CANONICAL');

    const values = await adapter.query<{ n: number }>('events');
    expect(values.map((v) => v.n).sort()).toEqual([1, 2]);
  });

  it('persists across adapter instances (same underlying db)', async () => {
    const first = new IndexedDbStorageAdapter(dbName);
    await first.put('events', 'evt-1', { text: 'persisted' }, 'CANONICAL');

    const second = new IndexedDbStorageAdapter(dbName);
    await expect(second.get('events', 'evt-1')).resolves.toEqual({ text: 'persisted' });
  });

  it('tracks byte usage per storage class', async () => {
    const adapter = new IndexedDbStorageAdapter(dbName);
    await adapter.put('events', 'evt-1', { text: 'hello' }, 'CANONICAL');
    await adapter.put('cache', 'c-1', { text: 'temp' }, 'CACHE');

    const usage = await adapter.usageByClass();
    expect(usage.CANONICAL).toBeGreaterThan(0);
    expect(usage.CACHE).toBeGreaterThan(0);
    expect(usage.DERIVED).toBe(0);
    expect(usage.RAW).toBe(0);
  });

  describe('putMany', () => {
    it('writes every entry, across different stores, from a single call', async () => {
      const adapter = new IndexedDbStorageAdapter(dbName);
      await adapter.putMany([
        { store: 'a', key: 'k1', value: { n: 1 }, storageClass: 'CANONICAL' },
        { store: 'b', key: 'k2', value: { n: 2 }, storageClass: 'DERIVED' },
      ]);

      await expect(adapter.get('a', 'k1')).resolves.toEqual({ n: 1 });
      await expect(adapter.get('b', 'k2')).resolves.toEqual({ n: 2 });
    });

    it('is a no-op for an empty entry list', async () => {
      const adapter = new IndexedDbStorageAdapter(dbName);
      await expect(adapter.putMany([])).resolves.toBeUndefined();
    });

    it('writes nothing if any single entry fails (all-or-nothing)', async () => {
      const adapter = new IndexedDbStorageAdapter(dbName);
      const unclonable = { fn: () => {} };

      await expect(
        adapter.putMany([
          { store: 'a', key: 'ok', value: { n: 1 }, storageClass: 'CANONICAL' },
          { store: 'a', key: 'bad', value: unclonable, storageClass: 'CANONICAL' },
        ]),
      ).rejects.toBeDefined();

      // The valid entry must not be visible either — the transaction aborted as a whole.
      await expect(adapter.get('a', 'ok')).resolves.toBeUndefined();
    });
  });
});
