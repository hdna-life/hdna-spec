import { IndexedDbStorageAdapter } from '../src/storage/indexeddb-adapter';
import { JobQueue } from '../src/queue/job-queue';
import { noopProcessor } from '../src/queue/processors/noop-processor';
import { PROCESS_EDIT_EVENT_JOB, createEditEventProcessor } from '../src/queue/processors/edit-event-processor';
import { RuntimeControls } from '../src/runtime/controls';
import { RuntimeStatusStore } from '../src/runtime/status';
import { ForegroundTracker } from '../src/runtime/foreground-tracker';
import { EditEventStore } from '../src/persona/edit-event-store';
import { EditMetricsStore } from '../src/persona/edit-metrics-store';
import { EditProfileStore } from '../src/persona/edit-profile-store';
import { WritingSampleStore } from '../src/persona/sample-store';
import { EmbeddingStore } from '../src/persona/embedding-store';
import { HashingEmbeddingProvider } from '../src/persona/hashing-embedding-provider';
import { VectorIndexService } from '../src/persona/vector-index-service';
import { editEventSource, writingSampleSource } from '../src/persona/embedding-sources';
import {
  INDEX_EMBEDDING_JOB,
  REBUILD_VECTOR_INDEX_JOB,
  createIndexEmbeddingProcessor,
  createRebuildVectorIndexProcessor,
} from '../src/queue/processors/embedding-jobs';
import { decide } from '../src/governor/resource-governor';
import { ALLOWED_PRIORITIES_BY_MODE } from '../src/governor/mode-priorities';
import type { GovernorSignals, RuntimeMode } from '../src/governor/types';
import { evictIfNeeded } from '../src/storage/eviction';
import { DEFAULT_STORAGE_POLICY } from '@spec/schema/storage-policy';

const DISPATCH_ALARM = 'hdna-dispatch';
const EXPECTED_JOB_LATENCY_MS = 50;

export default defineBackground(() => {
  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  queue.registerProcessor('noop', noopProcessor);
  const editEventStore = new EditEventStore(storage);
  queue.registerProcessor(
    PROCESS_EDIT_EVENT_JOB,
    createEditEventProcessor(storage, editEventStore, new EditMetricsStore(storage), new EditProfileStore(storage)),
  );

  const sampleStore = new WritingSampleStore(storage);
  const vectorIndex = new VectorIndexService(new HashingEmbeddingProvider(), new EmbeddingStore(storage), [
    writingSampleSource(sampleStore),
    editEventSource(editEventStore),
  ]);
  queue.registerProcessor(INDEX_EMBEDDING_JOB, createIndexEmbeddingProcessor(vectorIndex));
  queue.registerProcessor(REBUILD_VECTOR_INDEX_JOB, createRebuildVectorIndexProcessor(vectorIndex));

  const controls = new RuntimeControls(storage);
  const runtimeStatus = new RuntimeStatusStore(storage);
  const foregroundTracker = new ForegroundTracker();
  chrome.runtime.onConnect.addListener((port) => foregroundTracker.handleConnect(port));

  let batchSize = 4;
  let mode: RuntimeMode = 'BACKGROUND'; // conservative default before the first measurement

  chrome.alarms.create(DISPATCH_ALARM, { periodInMinutes: 0.5 });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== DISPATCH_ALARM) return;

    const state = await controls.get();
    if (state.processingPaused) return;

    const counts = await queue.countsByPriority();
    const totalBacklog = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalBacklog === 0) return;

    // Only priorities the current mode allows are dispatched; the rest stay
    // PENDING and are picked up once the mode relaxes (e.g. foreground goes
    // idle). queueBacklog still reflects the *total* backlog so the governor
    // can see pressure building even in classes it isn't currently running.
    const allowedPriorities = ALLOWED_PRIORITIES_BY_MODE[mode];
    const start = performance.now();
    let ran = 0;
    while (ran < batchSize) {
      const job = await queue.runNext(allowedPriorities);
      if (!job) break;
      ran += 1;
    }
    const elapsed = performance.now() - start;

    const signals: GovernorSignals = {
      queueBacklog: Math.max(0, totalBacklog - ran),
      // A neutral (ratio-1) reading when nothing ran this tick — e.g. every
      // pending job was outside the allowed priorities — so batch size
      // doesn't drift on a measurement that never happened.
      lastJobLatencyMs: ran > 0 ? elapsed / ran : EXPECTED_JOB_LATENCY_MS,
      expectedJobLatencyMs: EXPECTED_JOB_LATENCY_MS,
      foregroundActive: foregroundTracker.isActive,
    };
    const decision = decide(signals, batchSize);
    batchSize = decision.nextBatchSize;
    mode = decision.mode;

    // Eviction is deferred while the user is actively interacting —
    // "Foreground interaction always wins."
    let lastEviction: { at: string; bytesFreed: number } | undefined;
    if (mode !== 'INTERACTIVE') {
      const plan = await evictIfNeeded(storage, DEFAULT_STORAGE_POLICY);
      if (plan.bytesFreed > 0) lastEviction = { at: new Date().toISOString(), bytesFreed: plan.bytesFreed };
    }

    const previousStatus = await runtimeStatus.get();
    await runtimeStatus.set({
      mode,
      batchSize,
      updatedAt: new Date().toISOString(),
      lastEvictionAt: lastEviction?.at ?? previousStatus?.lastEvictionAt,
      lastEvictionBytesFreed: lastEviction?.bytesFreed ?? previousStatus?.lastEvictionBytesFreed,
    });
  });
});
