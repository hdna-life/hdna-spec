import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import {
  RUN_TRIAL4_BENCHMARK_CASE_JOB,
  RUN_TRIAL4_BENCHMARK_CASE_PRIORITY,
  createTrial4BenchmarkProcessor,
  enqueueTrial4BenchmarkCase,
} from '../../src/queue/processors/trial4-benchmark-job';
import { ALLOWED_PRIORITIES_BY_MODE } from '../../src/governor/mode-priorities';
import type { Trial4BenchmarkService } from '../../src/persona/trial4-benchmark-service';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const runNextCase = vi.fn(async () => undefined);
  const service = { runNextCase } as unknown as Trial4BenchmarkService;
  queue.registerProcessor(RUN_TRIAL4_BENCHMARK_CASE_JOB, createTrial4BenchmarkProcessor(service));
  return { queue, runNextCase };
}

describe('run_trial4_benchmark_case job', () => {
  it('is enqueued as P1 — NOT P3, so it dispatches under INTERACTIVE mode while the Dashboard tab (which is what triggers it) is open', async () => {
    const { queue } = setup();
    await enqueueTrial4BenchmarkCase(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P1: 1 });
  });

  it('P1 is allowed to dispatch under INTERACTIVE mode (foreground active) — the actual bug this priority choice fixes', () => {
    expect(ALLOWED_PRIORITIES_BY_MODE.INTERACTIVE).toContain(RUN_TRIAL4_BENCHMARK_CASE_PRIORITY);
  });

  it('invokes service.runNextCase() exactly once when run', async () => {
    const { queue, runNextCase } = setup();
    await enqueueTrial4BenchmarkCase(queue);

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    expect(runNextCase).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated triggers into a single outstanding job, and allows a new one after completion', async () => {
    const { queue } = setup();
    const first = await enqueueTrial4BenchmarkCase(queue);
    for (let i = 0; i < 10; i += 1) await enqueueTrial4BenchmarkCase(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P1: 1 });

    const completed = await queue.runNext();
    expect(completed?.id).toBe((first as { id: string }).id);
    expect(completed?.status).toBe('COMPLETE');

    const after = await enqueueTrial4BenchmarkCase(queue);
    expect((after as { id: string }).id).not.toBe((first as { id: string }).id);
  });

  it('is a distinct job name from Trial 3\'s judge_semantic_revisions job', async () => {
    expect(RUN_TRIAL4_BENCHMARK_CASE_JOB).toBe('run_trial4_benchmark_case');
    expect(RUN_TRIAL4_BENCHMARK_CASE_JOB).not.toBe('judge_semantic_revisions');
  });

  it('uses the exact service method runNextCase(), not runExperiment()', async () => {
    const { queue, runNextCase } = setup();
    await enqueueTrial4BenchmarkCase(queue);
    await queue.runNext();

    expect(runNextCase).toHaveBeenCalled();
  });
});
