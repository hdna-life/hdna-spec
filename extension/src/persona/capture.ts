import type { EditEvent } from '@spec/schema/edit-event';
import type { JobQueue } from '../queue/job-queue';
import type { EditEventStore } from './edit-event-store';
import { PROCESS_EDIT_EVENT_JOB, type ProcessEditEventPayload } from '../queue/processors/edit-event-processor';

/**
 * The Phase 2 passive-capture entry point: persist the raw evidence, enqueue
 * deferred deterministic processing, return immediately. No computation runs
 * on this call path — per the design doc's "user interaction -> minimal
 * event capture -> persist/queue -> return immediately -> deferred
 * deterministic processing" pipeline.
 */
export async function captureEditEvent(
  queue: JobQueue,
  eventStore: EditEventStore,
  sourceText: string,
  finalText: string,
  context?: EditEvent['context'],
): Promise<EditEvent> {
  const event = await eventStore.add(sourceText, finalText, context);
  await queue.enqueue<ProcessEditEventPayload>(PROCESS_EDIT_EVENT_JOB, 'P1', { editEventId: event.id });
  return event;
}
