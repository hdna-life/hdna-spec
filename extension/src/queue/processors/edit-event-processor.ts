import type { EditEventStore } from '../../persona/edit-event-store';
import type { EditMetricsStore } from '../../persona/edit-metrics-store';
import type { EditProfileStore } from '../../persona/edit-profile-store';
import { computeEditMetrics } from '../../persona/edit-metrics';
import type { JobProcessor } from '../job-queue';

export const PROCESS_EDIT_EVENT_JOB = 'process_edit_event';

export interface ProcessEditEventPayload {
  editEventId: string;
}

/**
 * P1 deferred processing: compute T0 diff metrics for one EditEvent, then
 * fold them into the running T1 EditProfile aggregate. No model call.
 */
export function createEditEventProcessor(
  eventStore: EditEventStore,
  metricsStore: EditMetricsStore,
  profileStore: EditProfileStore,
): JobProcessor<ProcessEditEventPayload> {
  return async ({ editEventId }) => {
    const event = await eventStore.get(editEventId);
    if (!event) throw new Error(`EditEvent "${editEventId}" not found`);

    const metrics = computeEditMetrics(event);
    await metricsStore.put(metrics);
    await profileStore.applyIncrement(metrics);
  };
}
