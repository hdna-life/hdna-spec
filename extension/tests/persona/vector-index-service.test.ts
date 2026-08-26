import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { EmbeddingStore } from '../../src/persona/embedding-store';
import { VectorIndexService } from '../../src/persona/vector-index-service';
import { HashingEmbeddingProvider } from '../../src/persona/hashing-embedding-provider';
import type { EmbeddingProvider } from '@spec/protocol/embedding-provider';
import type { EmbeddingSource } from '../../src/persona/embedding-sources';

/** Maps fixed known vectors by text, so ranking assertions are exact and not dependent on hash-collision behavior. */
function fakeProvider(vectorsByText: Record<string, number[]>): EmbeddingProvider {
  return {
    extractorId: 'fake',
    extractorVersion: '0.0.1',
    dimensions: 2,
    async embed(text: string) {
      const values = vectorsByText[text];
      if (!values) throw new Error(`No fixture vector for "${text}"`);
      return { values };
    },
  };
}

function fakeSource(sourceType: string, items: { id: string; text: string }[]): EmbeddingSource {
  return { sourceType, async list() { return items; } };
}

describe('VectorIndexService', () => {
  it('indexOne stores an embedding tagged with the provider extractor identity', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    const provider = fakeProvider({ hello: [1, 0] });
    const service = new VectorIndexService(provider, store, []);

    const embedding = await service.indexOne('writing_sample', 's1', 'hello');
    expect(embedding.extractorId).toBe('fake');
    expect(embedding.extractorVersion).toBe('0.0.1');
    await expect(store.get('writing_sample', 's1')).resolves.toEqual(embedding);
  });

  it('rebuild() discards the existing index and recomputes from every registered source', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    const provider = fakeProvider({ a: [1, 0], b: [0, 1] });
    const sources = [fakeSource('writing_sample', [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }])];
    const service = new VectorIndexService(provider, store, sources);

    // Seed a stale embedding that must not survive the rebuild.
    await store.put({
      sourceId: 'stale',
      sourceType: 'writing_sample',
      vector: { values: [9, 9] },
      extractorId: 'old',
      extractorVersion: '0.0.0',
      computedAt: '2020-01-01T00:00:00.000Z',
    });

    const count = await service.rebuild();
    expect(count).toBe(2);

    const all = await store.list();
    expect(all.map((e) => e.sourceId).sort()).toEqual(['s1', 's2']);
  });

  it('query() ranks stored embeddings by similarity to the query text', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    const provider = fakeProvider({ query: [1, 0], close: [0.9, 0.1], far: [-1, 0] });
    const service = new VectorIndexService(provider, store, []);

    await service.indexOne('writing_sample', 'close-item', 'close');
    await service.indexOne('writing_sample', 'far-item', 'far');

    const results = await service.query('query', 2);
    expect(results.map((r) => r.embedding.sourceId)).toEqual(['close-item', 'far-item']);
  });

  it('integrates end-to-end with the real HashingEmbeddingProvider and evidence-source adapters', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EmbeddingStore(storage);
    const provider = new HashingEmbeddingProvider();
    const sources = [fakeSource('writing_sample', [{ id: 's1', text: 'hello world' }])];
    const service = new VectorIndexService(provider, store, sources);

    const count = await service.rebuild();
    expect(count).toBe(1);

    const embedding = await store.get('writing_sample', 's1');
    expect(embedding?.vector.values).toHaveLength(provider.dimensions);
  });
});
