import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { EmbeddingStore } from '../../src/persona/embedding-store';
import type { Embedding } from '@spec/schema/embedding';

function embedding(overrides: Partial<Embedding> = {}): Embedding {
  return {
    sourceId: 'evt-1',
    sourceType: 'edit_event',
    vector: { values: [1, 0, 0] },
    extractorId: 'hashing-ngram',
    extractorVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('EmbeddingStore', () => {
  it('round-trips an embedding through put/get, keyed by sourceType+sourceId', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    const e = embedding();

    await store.put(e);
    await expect(store.get(e.sourceType, e.sourceId)).resolves.toEqual(e);
  });

  it('returns undefined for an unknown source', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    await expect(store.get('edit_event', 'missing')).resolves.toBeUndefined();
  });

  it('lists every stored embedding', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    await store.put(embedding({ sourceId: 'a' }));
    await store.put(embedding({ sourceId: 'b' }));

    const all = await store.list();
    expect(all.map((e) => e.sourceId).sort()).toEqual(['a', 'b']);
  });

  it('clears every stored embedding', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    await store.put(embedding({ sourceId: 'a' }));
    await store.put(embedding({ sourceId: 'b' }));

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores embeddings as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    await store.put(embedding());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });
});
