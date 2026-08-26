import type { EditMetrics } from '@spec/schema/edit-metrics';
import type { EditProfile } from '@spec/schema/edit-profile';
import type { StorageAdapter, StorageEntry } from '../storage/types';
import { applyEditMetrics } from './edit-profile';

const PERSONA_STORE = 'persona';
const EDIT_PROFILE_KEY = 'edit_profile';

/** Derived T1 aggregate profile over all EditMetrics observed so far. */
export class EditProfileStore {
  constructor(private storage: StorageAdapter) {}

  get(): Promise<EditProfile | undefined> {
    return this.storage.get<EditProfile>(PERSONA_STORE, EDIT_PROFILE_KEY);
  }

  /** Storage entry descriptor, for composing an atomic multi-key write via StorageAdapter.putMany(). */
  entryFor(profile: EditProfile): StorageEntry<EditProfile> {
    return { store: PERSONA_STORE, key: EDIT_PROFILE_KEY, value: profile, storageClass: 'DERIVED' };
  }

  /**
   * Convenience single-write path (used directly by its own unit tests).
   * Not used by the at-least-once-safe processor pipeline — see the warning
   * on EditMetricsStore.put().
   */
  async applyIncrement(metrics: EditMetrics): Promise<EditProfile> {
    const current = await this.get();
    const next = applyEditMetrics(current, metrics);
    await this.storage.putMany([this.entryFor(next)]);
    return next;
  }
}
