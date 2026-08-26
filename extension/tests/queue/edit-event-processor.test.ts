import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { EditMetricsStore } from '../../src/persona/edit-metrics-store';
import { EditProfileStore } from '../../src/persona/edit-profile-store';
import { captureEditEvent } from '../../src/persona/capture';
import {
  PROCESS_EDIT_EVENT_JOB,
  createEditEventProcessor,
} from '../../src/queue/processors/edit-event-processor';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const eventStore = new EditEventStore(storage);
  const metricsStore = new EditMetricsStore(storage);
  const profileStore = new EditProfileStore(storage);
  queue.registerProcessor(
    PROCESS_EDIT_EVENT_JOB,
    createEditEventProcessor(storage, eventStore, metricsStore, profileStore),
  );
  return { storage, queue, eventStore, metricsStore, profileStore };
}

describe('edit-event capture -> processing pipeline', () => {
  it('persists the event and enqueues a P1 job without computing anything synchronously', async () => {
    const { queue, eventStore } = setup();
    const event = await captureEditEvent(queue, eventStore, 'ai text', 'edited text');

    const counts = await queue.countsByPriority();
    expect(counts.P1).toBe(1);
    await expect(eventStore.get(event.id)).resolves.toEqual(event);
  });

  it('computes metrics and updates the profile when the queued job runs', async () => {
    const { queue, eventStore, metricsStore, profileStore } = setup();
    const event = await captureEditEvent(queue, eventStore, 'cat sat.', 'cat sat down.');

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');

    const metrics = await metricsStore.get(event.id);
    expect(metrics?.editEventId).toBe(event.id);

    const profile = await profileStore.get();
    expect(profile?.sampleCount).toBe(1);
  });

  it('accumulates the profile across multiple captured events', async () => {
    const { queue, eventStore, profileStore } = setup();
    await captureEditEvent(queue, eventStore, 'short.', 'short one.');
    await captureEditEvent(queue, eventStore, 'another short one.', 'yet another short one here.');

    await queue.runNext();
    await queue.runNext();

    const profile = await profileStore.get();
    expect(profile?.sampleCount).toBe(2);
  });

  it('fails the job with a descriptive error if the event is missing', async () => {
    const { queue } = setup();
    await queue.enqueue(PROCESS_EDIT_EVENT_JOB, 'P1', { editEventId: 'does-not-exist' });

    const job = await queue.runNext();
    expect(job?.status).toBe('FAILED');
    expect(job?.lastError).toContain('does-not-exist');
  });

  it('does not double-count the profile if the same job is run twice (at-least-once safety)', async () => {
    const { queue, eventStore, profileStore } = setup();
    const event = await eventStore.add('cat sat.', 'cat sat down.');
    const payload = { editEventId: event.id };

    // Simulate the queue re-dispatching the same logical job twice — e.g. a
    // stale-RUNNING reclaim retried it after the service worker died just
    // after the first run's atomic write had already landed.
    await queue.enqueue(PROCESS_EDIT_EVENT_JOB, 'P1', payload);
    await queue.enqueue(PROCESS_EDIT_EVENT_JOB, 'P1', payload);

    await queue.runNext();
    await queue.runNext();

    const profile = await profileStore.get();
    expect(profile?.sampleCount).toBe(1);
  });

  it('treats a pre-existing profileAppliedAt receipt as already-processed and skips re-applying', async () => {
    const { storage, queue, eventStore, metricsStore, profileStore } = setup();
    const event = await eventStore.add('cat sat.', 'cat sat down.');

    // Seed a completed state directly, as if a prior run had already landed.
    const priorProfile = { sampleCount: 1, meanEditDistance: 5, meanCompressionRatio: 1.5, meanLexicalOverlap: 0.5, updatedAt: '2026-01-01T00:00:00.000Z' };
    await storage.putMany([
      metricsStore.entryFor({
        editEventId: event.id,
        editDistance: 5,
        compressionRatio: 1.5,
        sentenceCountChange: 0,
        lexicalOverlap: 0.5,
        computedAt: '2026-01-01T00:00:00.000Z',
        profileAppliedAt: '2026-01-01T00:00:00.000Z',
      }),
      profileStore.entryFor(priorProfile),
    ]);

    await queue.enqueue(PROCESS_EDIT_EVENT_JOB, 'P1', { editEventId: event.id });
    const job = await queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    await expect(profileStore.get()).resolves.toEqual(priorProfile);
  });
});
