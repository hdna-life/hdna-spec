import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const CANDIDATE_STORE = 'trial4_training_candidates';

/**
 * DeepSeek-generated candidate training examples, pending/accepted/
 * rejected by human review (docs/decisions/0017). `CACHE`, not `DERIVED`
 * — these are disposable, reproducible-by-regeneration experimental
 * training material, never canonical persona evidence (unlike
 * `SemanticDeltaCandidate`, which Trial 0-3 classify `DERIVED`).
 */
export class Trial4TrainingCandidateStore {
  constructor(private storage: StorageAdapter) {}

  entryFor(candidate: Trial4TrainingCandidate): StorageEntry<Trial4TrainingCandidate> {
    return { store: CANDIDATE_STORE, key: candidate.id, value: candidate, storageClass: 'CACHE' };
  }

  async put(candidate: Trial4TrainingCandidate): Promise<void> {
    await this.storage.put(CANDIDATE_STORE, candidate.id, candidate, 'CACHE');
  }

  get(id: string): Promise<Trial4TrainingCandidate | undefined> {
    return this.storage.get<Trial4TrainingCandidate>(CANDIDATE_STORE, id);
  }

  list(): Promise<Trial4TrainingCandidate[]> {
    return this.storage.query<Trial4TrainingCandidate>(CANDIDATE_STORE);
  }

  async clear(): Promise<void> {
    for (const candidate of await this.list()) {
      await this.storage.delete(CANDIDATE_STORE, candidate.id);
    }
  }
}
