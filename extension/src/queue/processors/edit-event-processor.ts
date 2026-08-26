import type { EditEventStore } from '../../persona/edit-event-store';
import type { EditMetricsStore } from '../../persona/edit-metrics-store';
import type { EditProfileStore } from '../../persona/edit-profile-store';
import { computeEditMetrics } from '../../persona/edit-metrics';
import { applyEditMetrics } from '../../persona/edit-profile';
import type { StorageAdapter } from '../../storage/types';
import type { JobProcessor } from '../job-queue';

export const PROCESS_EDIT_EVENT_JOB = 'process_edit_event';

export interface ProcessEditEventPayload {
  editEventId: string;
}

/**
 * P1 deferred processing: compute T0 diff metrics for one EditEvent, then
 * fold them into the running T1 EditProfile aggregate. No model call.
 *
 * The job queue is at-least-once (see job-queue.ts's stale-RUNNING reclaim),
 * so this processor must tolerate running more than once for the same
 * EditEvent:
 *  - Recomputing metrics is safe — computeEditMetrics is a pure function of
 *    the event, so redoing it yields the identical result.
 *  - Applying the same metrics to EditProfile twice is NOT safe — it would
 *    double-count. EditMetrics.profileAppliedAt is the idempotency receipt:
 *    if it's already set, this event was already folded in and this run is
 *    a no-op. The metrics write and the profile write happen in one atomic
 *    StorageAdapter.putMany() call, so a crash between "profile updated" and
 *    "receipt persisted" — the one window a plain two-step write can't close
 *    — can't happen here: either both land, or neither does.
 */
export function createEditEventProcessor(
  storage: StorageAdapter,
  eventStore: EditEventStore,
  metricsStore: EditMetricsStore,
  profileStore: EditProfileStore,
): JobProcessor<ProcessEditEventPayload> {
  return async ({ editEventId }) => {
    const event = await eventStore.get(editEventId);
    if (!event) throw new Error(`EditEvent "${editEventId}" not found`);

    const existingMetrics = await metricsStore.get(editEventId);
    if (existingMetrics?.profileAppliedAt) return;

    const metrics = computeEditMetrics(event);
    const currentProfile = await profileStore.get();
    const nextProfile = applyEditMetrics(currentProfile, metrics);
    const appliedMetrics = { ...metrics, profileAppliedAt: new Date().toISOString() };

    await storage.putMany([metricsStore.entryFor(appliedMetrics), profileStore.entryFor(nextProfile)]);
  };
}
