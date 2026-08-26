import { IndexedDbStorageAdapter } from '../src/storage/indexeddb-adapter';
import { JobQueue } from '../src/queue/job-queue';
import { noopProcessor } from '../src/queue/processors/noop-processor';
import { RuntimeControls } from '../src/runtime/controls';
import { decide } from '../src/governor/resource-governor';
import type { GovernorSignals } from '../src/governor/types';

const DISPATCH_ALARM = 'hdna-dispatch';
const EXPECTED_JOB_LATENCY_MS = 50;

export default defineBackground(() => {
  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  queue.registerProcessor('noop', noopProcessor);
  const controls = new RuntimeControls(storage);

  let batchSize = 4;

  chrome.alarms.create(DISPATCH_ALARM, { periodInMinutes: 0.5 });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== DISPATCH_ALARM) return;

    const state = await controls.get();
    if (state.processingPaused) return;

    const counts = await queue.countsByPriority();
    const backlog = Object.values(counts).reduce((a, b) => a + b, 0);
    if (backlog === 0) return;

    const start = performance.now();
    let ran = 0;
    while (ran < batchSize) {
      const job = await queue.runNext();
      if (!job) break;
      ran += 1;
    }
    const elapsed = performance.now() - start;

    const signals: GovernorSignals = {
      queueBacklog: Math.max(0, backlog - ran),
      lastJobLatencyMs: ran > 0 ? elapsed / ran : 0,
      expectedJobLatencyMs: EXPECTED_JOB_LATENCY_MS,
      foregroundActive: false,
    };
    batchSize = decide(signals, batchSize).nextBatchSize;
  });
});
