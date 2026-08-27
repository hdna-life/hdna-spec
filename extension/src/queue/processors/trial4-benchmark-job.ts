import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { Trial4BenchmarkService } from '../../persona/trial4-benchmark-service';

export const RUN_TRIAL4_BENCHMARK_CASE_JOB = 'run_trial4_benchmark_case';
export const RUN_TRIAL4_BENCHMARK_CASE_PRIORITY: JobPriority = 'P3';

export function enqueueTrial4BenchmarkCase(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(RUN_TRIAL4_BENCHMARK_CASE_JOB, RUN_TRIAL4_BENCHMARK_CASE_PRIORITY, {});
}

/**
 * P3: manually-triggered-only Trial 4 blind-benchmark run, one held-out
 * case per job — mirrors Trial 3's per-source job shape
 * (`semantic-revision-judge-job.ts`), not a full-rebuild job. The Svelte
 * panel's "Run next case" button enqueues this once per click; the
 * popup's existing 2s refresh() poll picks up the newly-persisted
 * `Trial4BenchmarkResult` from storage, same pattern every other
 * experimental panel in this codebase already uses.
 */
export function createTrial4BenchmarkProcessor(service: Trial4BenchmarkService): JobProcessor<unknown> {
  return async () => {
    await service.runNextCase();
  };
}
