import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { RuntimeStatusStore } from '../../src/runtime/status';
import { computeForegroundInactivity } from '../../src/runtime/foreground-inactivity';
import { decide, decideMode, DEEP_IDLE_AFTER_INACTIVE_MS } from '../../src/governor/resource-governor';
import { ALLOWED_PRIORITIES_BY_MODE } from '../../src/governor/mode-priorities';
import type { GovernorSignals } from '../../src/governor/types';
import type { RuntimeMode } from '../../src/governor/types';

const EXPECTED_JOB_LATENCY_MS = 50;

/**
 * Simulates exactly one MV3 dispatch tick as a *fresh* worker instance: new
 * StorageAdapter/JobQueue/RuntimeStatusStore objects sharing no in-memory
 * state with any prior call, reconstructing all lifecycle-relevant state
 * (mode, inactivity duration, batch size) from persisted storage alone —
 * mirroring a real service-worker restart between every dispatch alarm.
 * This is the integration-level counterpart to the pure decideMode()/
 * computeForegroundInactivity() unit tests: it proves the *wiring* in
 * background.ts's tick logic, not just the pure functions in isolation.
 */
async function simulateWorkerRestartTick(
  dbName: string,
  nowMs: number,
  foregroundActive: boolean,
): Promise<{ mode: RuntimeMode; ranJobId: string | undefined }> {
  const storage = new IndexedDbStorageAdapter(dbName);
  const queue = new JobQueue(storage);
  let executed: string[] = [];
  queue.registerProcessor('rebuild_t2_profile', async () => {
    executed.push('rebuild_t2_profile');
  });
  queue.registerProcessor('classify_evidence', async () => {
    executed.push('classify_evidence');
  });
  const runtimeStatus = new RuntimeStatusStore(storage);

  const previousStatus = await runtimeStatus.get();
  const { foregroundInactiveSince, inactiveDurationMs } = computeForegroundInactivity(
    previousStatus?.foregroundInactiveSince,
    foregroundActive,
    nowMs,
  );
  const mode = decideMode(foregroundActive, inactiveDurationMs);
  const allowedPriorities = ALLOWED_PRIORITIES_BY_MODE[mode];

  const job = await queue.runNext(allowedPriorities);

  const signals: GovernorSignals = {
    queueBacklog: Object.values(await queue.countsByPriority()).reduce((a, b) => a + b, 0),
    lastJobLatencyMs: EXPECTED_JOB_LATENCY_MS,
    expectedJobLatencyMs: EXPECTED_JOB_LATENCY_MS,
    foregroundActive,
    foregroundInactiveDurationMs: inactiveDurationMs,
  };
  const decision = decide(signals, previousStatus?.batchSize ?? 4);

  await runtimeStatus.set({
    mode,
    batchSize: decision.nextBatchSize,
    updatedAt: new Date(nowMs).toISOString(),
    foregroundInactiveSince,
  });

  return { mode, ranJobId: job?.status === 'COMPLETE' ? job.id : undefined };
}

describe('MV3 lifecycle: P3 dispatch survives worker restart between every tick (docs/decisions/0014)', () => {
  it('a pending P3 job becomes eligible and completes after sustained real inactivity, even when every tick reconstructs state from storage with no shared in-memory state', async () => {
    const dbName = `hdna-lifecycle-${Math.random()}`;
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    const tickIntervalMs = 30_000; // matches the real alarm cadence in background.ts

    // Step 1: foreground inactive. Step onward: seed the P3 job via its own
    // throwaway queue instance — nothing from this leaks into the tick loop.
    const seedStorage = new IndexedDbStorageAdapter(dbName);
    const seedQueue = new JobQueue(seedStorage);
    const seeded = await seedQueue.enqueue('rebuild_t2_profile', 'P3', {});

    const modesSeen: RuntimeMode[] = [];
    let completedJobId: string | undefined;

    // Steps 2-5: repeated "dispatch/wake -> reconstruct from storage" ticks,
    // each one a brand-new simulateWorkerRestartTick() call (fresh adapter,
    // fresh queue, fresh status store) — i.e. worker restart between every
    // single tick, not just occasionally.
    for (let tick = 0; tick < 10; tick += 1) {
      const nowMs = t0 + tick * tickIntervalMs;
      const result = await simulateWorkerRestartTick(dbName, nowMs, false);
      modesSeen.push(result.mode);
      if (result.ranJobId) {
        completedJobId = result.ranJobId;
        break;
      }
    }

    // Step 6/7: enough elapsed real time passed (10 * 30s = 300s, comfortably
    // past the 90s threshold) that the pending P3 job became runnable and
    // actually completed — proving worker restart between every tick cannot
    // prevent eventual P3 execution.
    expect(completedJobId).toBe(seeded.id);
    expect(modesSeen).toContain('DEEP_IDLE');
    // Mode must not have jumped to DEEP_IDLE before the threshold — the
    // first three ticks (0s, 30s, 60s) are all under DEEP_IDLE_AFTER_INACTIVE_MS (90s).
    expect(modesSeen.slice(0, 3)).toEqual(['BACKGROUND', 'BACKGROUND', 'BACKGROUND']);
    expect(DEEP_IDLE_AFTER_INACTIVE_MS).toBe(90_000);

    // Confirm the job is actually COMPLETE in persisted storage, not just
    // reported complete transiently.
    const finalStorage = new IndexedDbStorageAdapter(dbName);
    const finalJob = await finalStorage.get('jobs', seeded.id);
    expect((finalJob as { status: string } | undefined)?.status).toBe('COMPLETE');
  });

  it('P0-P2 jobs still dispatch normally in BACKGROUND mode while a P3 job waits, across the same restart-every-tick pattern', async () => {
    const dbName = `hdna-lifecycle-${Math.random()}`;
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');

    const seedStorage = new IndexedDbStorageAdapter(dbName);
    const seedQueue = new JobQueue(seedStorage);
    const p3Job = await seedQueue.enqueue('rebuild_t2_profile', 'P3', {});
    const p2Job = await seedQueue.enqueue('classify_evidence', 'P2', {});

    // First tick, still short inactivity (0s elapsed) -> BACKGROUND, so P0-P2
    // is allowed but P3 is not.
    const result = await simulateWorkerRestartTick(dbName, t0, false);
    expect(result.mode).toBe('BACKGROUND');
    expect(result.ranJobId).toBe(p2Job.id);

    const finalStorage = new IndexedDbStorageAdapter(dbName);
    const p3Status = (await finalStorage.get('jobs', p3Job.id)) as { status: string } | undefined;
    expect(p3Status?.status).toBe('PENDING'); // untouched — still gated out of BACKGROUND mode
  });

  it('foreground reactivation immediately cancels DEEP_IDLE eligibility, even after sustained accumulated inactivity, reconstructed purely from storage', async () => {
    const dbName = `hdna-lifecycle-${Math.random()}`;
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');

    // Accumulate well past the DEEP_IDLE threshold across restart-every-tick.
    let nowMs = t0;
    let result = await simulateWorkerRestartTick(dbName, nowMs, false);
    nowMs += 120_000;
    result = await simulateWorkerRestartTick(dbName, nowMs, false);
    expect(result.mode).toBe('DEEP_IDLE');

    // Foreground becomes active on the very next tick: must be INTERACTIVE
    // immediately, not still DEEP_IDLE for one more tick.
    nowMs += 1_000;
    result = await simulateWorkerRestartTick(dbName, nowMs, true);
    expect(result.mode).toBe('INTERACTIVE');

    // And if foreground goes inactive again right after, the clock restarts
    // from 0 — it does not resume the old accumulated duration.
    nowMs += 1_000;
    result = await simulateWorkerRestartTick(dbName, nowMs, false);
    expect(result.mode).toBe('BACKGROUND');
  });

  it('P3 never executes while foreground is active/INTERACTIVE, across a full restart-every-tick simulation', async () => {
    const dbName = `hdna-lifecycle-${Math.random()}`;
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');

    const seedStorage = new IndexedDbStorageAdapter(dbName);
    const seedQueue = new JobQueue(seedStorage);
    const p3Job = await seedQueue.enqueue('rebuild_t2_profile', 'P3', {});

    for (let tick = 0; tick < 10; tick += 1) {
      const result = await simulateWorkerRestartTick(dbName, t0 + tick * 30_000, true);
      expect(result.mode).toBe('INTERACTIVE');
      expect(result.ranJobId).toBeUndefined();
    }

    const finalStorage = new IndexedDbStorageAdapter(dbName);
    const finalStatus = (await finalStorage.get('jobs', p3Job.id)) as { status: string } | undefined;
    expect(finalStatus?.status).toBe('PENDING');
  });
});
