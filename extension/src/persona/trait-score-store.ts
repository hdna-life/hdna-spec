import type { TraitScoreRecord } from '@spec/schema/trait-score';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const TRAIT_SCORE_STORE = 'trait_scores';

/** Derived per-evidence classifier output, keyed by sourceType:sourceId. Rebuildable at any time. */
export class TraitScoreStore {
  constructor(private storage: StorageAdapter) {}

  private key(sourceType: string, sourceId: string): string {
    return `${sourceType}:${sourceId}`;
  }

  /** Storage entry descriptor, for composing an atomic multi-key write via StorageAdapter.putMany(). */
  entryFor(record: TraitScoreRecord): StorageEntry<TraitScoreRecord> {
    return { store: TRAIT_SCORE_STORE, key: this.key(record.sourceType, record.sourceId), value: record, storageClass: 'DERIVED' };
  }

  get(sourceType: string, sourceId: string): Promise<TraitScoreRecord | undefined> {
    return this.storage.get<TraitScoreRecord>(TRAIT_SCORE_STORE, this.key(sourceType, sourceId));
  }

  list(): Promise<TraitScoreRecord[]> {
    return this.storage.query<TraitScoreRecord>(TRAIT_SCORE_STORE);
  }

  async clear(): Promise<void> {
    for (const record of await this.list()) {
      await this.storage.delete(TRAIT_SCORE_STORE, this.key(record.sourceType, record.sourceId));
    }
  }
}
