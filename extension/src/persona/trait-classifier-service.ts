import type { TraitScoreRecord } from '@spec/schema/trait-score';
import type { TinyClassifier } from '@spec/protocol/tiny-classifier';
import type { StorageAdapter } from '../storage/types';
import type { EmbeddingSource } from './embedding-sources';
import type { TraitScoreStore } from './trait-score-store';
import type { T2ProfileStore } from './t2-profile-store';
import { applyTraitScore } from './t2-profile';

/**
 * Ties a TinyClassifier, TraitScoreStore, T2ProfileStore, and canonical
 * evidence sources together — the same shape as VectorIndexService, and the
 * same at-least-once/idempotency pattern as edit-event-processor.ts
 * (docs/decisions/0007): re-running classifyOne() for an already-applied
 * source is a safe no-op, and the receipt + profile update land atomically.
 */
export class TraitClassifierService {
  constructor(
    private storage: StorageAdapter,
    private classifier: TinyClassifier,
    private traitScoreStore: TraitScoreStore,
    private profileStore: T2ProfileStore,
    private sources: EmbeddingSource[],
  ) {}

  async classifyOne(sourceType: string, sourceId: string, text: string): Promise<void> {
    const existing = await this.traitScoreStore.get(sourceType, sourceId);
    if (existing?.profileAppliedAt) return;

    const result = await this.classifier.classify(text);
    const record: TraitScoreRecord = {
      sourceId,
      sourceType,
      scores: result.scores,
      confidence: result.confidence,
      extractorId: this.classifier.extractorId,
      extractorVersion: this.classifier.extractorVersion,
      computedAt: new Date().toISOString(),
    };

    const currentProfile = await this.profileStore.get();
    const nextProfile = applyTraitScore(currentProfile, record);
    const appliedRecord: TraitScoreRecord = { ...record, profileAppliedAt: new Date().toISOString() };

    await this.storage.putMany([this.traitScoreStore.entryFor(appliedRecord), this.profileStore.entryFor(nextProfile)]);
  }

  /** Discards the current trait scores and profile, then recomputes from every registered canonical evidence source. Returns the number of records (re)built. */
  async rebuild(): Promise<number> {
    await this.traitScoreStore.clear();
    await this.profileStore.clear();

    let count = 0;
    for (const source of this.sources) {
      for (const item of await source.list()) {
        await this.classifyOne(source.sourceType, item.id, item.text);
        count += 1;
      }
    }
    return count;
  }
}
