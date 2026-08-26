import type { EditMetrics } from '@spec/schema/edit-metrics';
import type { StorageAdapter } from '../storage/types';

const EDIT_METRICS_STORE = 'edit_metrics';

/** Derived T0 diff metrics, keyed by the EditEvent they were computed from. Rebuildable at any time. */
export class EditMetricsStore {
  constructor(private storage: StorageAdapter) {}

  async put(metrics: EditMetrics): Promise<void> {
    await this.storage.put(EDIT_METRICS_STORE, metrics.editEventId, metrics, 'DERIVED');
  }

  get(editEventId: string): Promise<EditMetrics | undefined> {
    return this.storage.get<EditMetrics>(EDIT_METRICS_STORE, editEventId);
  }

  list(): Promise<EditMetrics[]> {
    return this.storage.query<EditMetrics>(EDIT_METRICS_STORE);
  }
}
