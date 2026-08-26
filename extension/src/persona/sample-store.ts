import type { WritingSample } from '@spec/schema/writing-sample';
import type { StorageAdapter } from '../storage/types';

const SAMPLE_STORE = 'writing_samples';

/**
 * Real writing samples explicitly provided during onboarding. Canonical
 * evidence — never deleted under storage pressure except by explicit user
 * policy, per the design doc's storage policy.
 */
export class WritingSampleStore {
  constructor(private storage: StorageAdapter) {}

  async addSample(text: string, context?: WritingSample['context']): Promise<WritingSample> {
    const sample: WritingSample = {
      id: crypto.randomUUID(),
      text,
      context,
      createdAt: new Date().toISOString(),
    };
    await this.storage.put(SAMPLE_STORE, sample.id, sample, 'CANONICAL');
    return sample;
  }

  list(): Promise<WritingSample[]> {
    return this.storage.query<WritingSample>(SAMPLE_STORE);
  }
}
