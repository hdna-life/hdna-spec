import type { T2Profile } from '@spec/schema/t2-profile';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const PERSONA_STORE = 'persona';
const T2_PROFILE_KEY = 't2_profile';

/** Derived T1-style running aggregate over every TraitScoreRecord observed so far. */
export class T2ProfileStore {
  constructor(private storage: StorageAdapter) {}

  get(): Promise<T2Profile | undefined> {
    return this.storage.get<T2Profile>(PERSONA_STORE, T2_PROFILE_KEY);
  }

  /** Storage entry descriptor, for composing an atomic multi-key write via StorageAdapter.putMany(). */
  entryFor(profile: T2Profile): StorageEntry<T2Profile> {
    return { store: PERSONA_STORE, key: T2_PROFILE_KEY, value: profile, storageClass: 'DERIVED' };
  }

  async clear(): Promise<void> {
    await this.storage.delete(PERSONA_STORE, T2_PROFILE_KEY);
  }
}
