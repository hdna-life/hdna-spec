import type { Embedding } from '@spec/schema/embedding';
import type { StorageAdapter } from '../storage/types';

const EMBEDDING_STORE = 'embeddings';

/** Derived embeddings, one per canonical evidence record. Fully rebuildable — see VectorIndexService.rebuild(). */
export class EmbeddingStore {
  constructor(private storage: StorageAdapter) {}

  private key(sourceType: string, sourceId: string): string {
    return `${sourceType}:${sourceId}`;
  }

  async put(embedding: Embedding): Promise<void> {
    await this.storage.put(EMBEDDING_STORE, this.key(embedding.sourceType, embedding.sourceId), embedding, 'DERIVED');
  }

  get(sourceType: string, sourceId: string): Promise<Embedding | undefined> {
    return this.storage.get<Embedding>(EMBEDDING_STORE, this.key(sourceType, sourceId));
  }

  list(): Promise<Embedding[]> {
    return this.storage.query<Embedding>(EMBEDDING_STORE);
  }

  async clear(): Promise<void> {
    for (const embedding of await this.list()) {
      await this.storage.delete(EMBEDDING_STORE, this.key(embedding.sourceType, embedding.sourceId));
    }
  }
}
