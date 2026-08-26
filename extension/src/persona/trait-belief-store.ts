import type { TraitBeliefClaim } from '@spec/schema/trait-belief';
import type { StorageAdapter } from '../storage/types';

const TRAIT_BELIEF_STORE = 'trait_beliefs';

/** Derived TRAITS/BELIEFS claims, keyed by id. Fully rebuildable from PatternStore via PersonaInterpreterService.interpret(). */
export class TraitBeliefStore {
  constructor(private storage: StorageAdapter) {}

  async put(claim: TraitBeliefClaim): Promise<void> {
    await this.storage.put(TRAIT_BELIEF_STORE, claim.id, claim, 'DERIVED');
  }

  get(id: string): Promise<TraitBeliefClaim | undefined> {
    return this.storage.get<TraitBeliefClaim>(TRAIT_BELIEF_STORE, id);
  }

  list(): Promise<TraitBeliefClaim[]> {
    return this.storage.query<TraitBeliefClaim>(TRAIT_BELIEF_STORE);
  }

  async clear(): Promise<void> {
    for (const claim of await this.list()) {
      await this.storage.delete(TRAIT_BELIEF_STORE, claim.id);
    }
  }
}
