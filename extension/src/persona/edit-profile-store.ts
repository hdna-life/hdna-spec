import type { EditMetrics } from '@spec/schema/edit-metrics';
import type { EditProfile } from '@spec/schema/edit-profile';
import type { StorageAdapter } from '../storage/types';
import { applyEditMetrics } from './edit-profile';

const PERSONA_STORE = 'persona';
const EDIT_PROFILE_KEY = 'edit_profile';

/** Derived T1 aggregate profile over all EditMetrics observed so far. */
export class EditProfileStore {
  constructor(private storage: StorageAdapter) {}

  get(): Promise<EditProfile | undefined> {
    return this.storage.get<EditProfile>(PERSONA_STORE, EDIT_PROFILE_KEY);
  }

  async applyIncrement(metrics: EditMetrics): Promise<EditProfile> {
    const current = await this.get();
    const next = applyEditMetrics(current, metrics);
    await this.storage.put(PERSONA_STORE, EDIT_PROFILE_KEY, next, 'DERIVED');
    return next;
  }
}
