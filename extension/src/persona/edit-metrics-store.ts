import type { EditMetrics } from '@spec/schema/edit-metrics';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const EDIT_METRICS_STORE = 'edit_metrics';

/** Derived T0 diff metrics, keyed by the EditEvent they were computed from. Rebuildable at any time. */
export class EditMetricsStore {
  constructor(private storage: StorageAdapter) {}

  /** Storage entry descriptor, for composing an atomic multi-key write via StorageAdapter.putMany(). */
  entryFor(metrics: EditMetrics): StorageEntry<EditMetrics> {
    return { store: EDIT_METRICS_STORE, key: metrics.editEventId, value: metrics, storageClass: 'DERIVED' };
  }

  /**
   * Convenience single-write path. Not used by the at-least-once-safe
   * processor pipeline (see edit-event-processor.ts), which instead writes
   * this store's entry atomically together with the EditProfile update via
   * entryFor() + StorageAdapter.putMany() — a standalone put() here plus a
   * separate EditProfileStore write would reopen the double-apply race this
   * design is meant to close.
   */
  async put(metrics: EditMetrics): Promise<void> {
    await this.storage.putMany([this.entryFor(metrics)]);
  }

  get(editEventId: string): Promise<EditMetrics | undefined> {
    return this.storage.get<EditMetrics>(EDIT_METRICS_STORE, editEventId);
  }

  list(): Promise<EditMetrics[]> {
    return this.storage.query<EditMetrics>(EDIT_METRICS_STORE);
  }
}
