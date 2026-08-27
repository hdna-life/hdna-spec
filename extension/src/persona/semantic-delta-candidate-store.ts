import type { SemanticDeltaCandidate } from '@spec/schema/semantic-delta-candidate';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const CANDIDATE_STORE = 'semantic_delta_candidates';

/** Derived Phase 5A evidence candidates, keyed by id. See docs/decisions/0016. */
export class SemanticDeltaCandidateStore {
  constructor(private storage: StorageAdapter) {}

  /** Storage entry descriptor, for composing an atomic multi-key write via StorageAdapter.putMany() alongside the processing receipt. */
  entryFor(candidate: SemanticDeltaCandidate): StorageEntry<SemanticDeltaCandidate> {
    return { store: CANDIDATE_STORE, key: candidate.id, value: candidate, storageClass: 'DERIVED' };
  }

  async put(candidate: SemanticDeltaCandidate): Promise<void> {
    await this.storage.put(CANDIDATE_STORE, candidate.id, candidate, 'DERIVED');
  }

  get(id: string): Promise<SemanticDeltaCandidate | undefined> {
    return this.storage.get<SemanticDeltaCandidate>(CANDIDATE_STORE, id);
  }

  list(): Promise<SemanticDeltaCandidate[]> {
    return this.storage.query<SemanticDeltaCandidate>(CANDIDATE_STORE);
  }

  async clear(): Promise<void> {
    for (const candidate of await this.list()) {
      await this.storage.delete(CANDIDATE_STORE, candidate.id);
    }
  }
}
