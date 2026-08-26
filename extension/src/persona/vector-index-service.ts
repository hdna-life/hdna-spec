import type { Embedding } from '@spec/schema/embedding';
import type { EmbeddingProvider } from '@spec/protocol/embedding-provider';
import type { EmbeddingSource } from './embedding-sources';
import { EmbeddingStore } from './embedding-store';
import { queryNearest, type ScoredEmbedding } from './vector-index';

/**
 * Ties an EmbeddingProvider, EmbeddingStore, and the canonical evidence
 * sources together. The contract this exists to guarantee: the index is
 * always fully reconstructable from canonical evidence — never a store of
 * record itself.
 */
export class VectorIndexService {
  constructor(
    private provider: EmbeddingProvider,
    private store: EmbeddingStore,
    private sources: EmbeddingSource[],
  ) {}

  async indexOne(sourceType: string, sourceId: string, text: string): Promise<Embedding> {
    const vector = await this.provider.embed(text);
    const embedding: Embedding = {
      sourceId,
      sourceType,
      vector,
      extractorId: this.provider.extractorId,
      extractorVersion: this.provider.extractorVersion,
      computedAt: new Date().toISOString(),
    };
    await this.store.put(embedding);
    return embedding;
  }

  /** Discards the current index and recomputes it from every registered canonical evidence source. Returns the number of embeddings (re)built. */
  async rebuild(): Promise<number> {
    await this.store.clear();
    let count = 0;
    for (const source of this.sources) {
      for (const item of await source.list()) {
        await this.indexOne(source.sourceType, item.id, item.text);
        count += 1;
      }
    }
    return count;
  }

  async query(text: string, k = 5): Promise<ScoredEmbedding[]> {
    const queryVector = await this.provider.embed(text);
    const candidates = await this.store.list();
    return queryNearest(queryVector, candidates, k);
  }
}
