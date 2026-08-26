import type { Pattern } from '@spec/schema/pattern';
import type { StorageAdapter } from '../storage/types';

const PATTERN_STORE = 'patterns';

/** Derived contextual patterns, keyed by dimension:context. Fully rebuildable from underlying evidence via PatternCompiler.compile(). */
export class PatternStore {
  constructor(private storage: StorageAdapter) {}

  private key(dimension: string, context: string): string {
    return `${dimension}:${context}`;
  }

  async put(pattern: Pattern): Promise<void> {
    await this.storage.put(PATTERN_STORE, this.key(pattern.dimension, pattern.context), pattern, 'DERIVED');
  }

  get(dimension: string, context: string): Promise<Pattern | undefined> {
    return this.storage.get<Pattern>(PATTERN_STORE, this.key(dimension, context));
  }

  list(): Promise<Pattern[]> {
    return this.storage.query<Pattern>(PATTERN_STORE);
  }

  async clear(): Promise<void> {
    for (const pattern of await this.list()) {
      await this.storage.delete(PATTERN_STORE, this.key(pattern.dimension, pattern.context));
    }
  }
}
