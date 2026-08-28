import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { Trial4BenchmarkService } from '../../persona/trial4-benchmark-service';

export const RUN_TRIAL4_BENCHMARK_CASE_JOB = 'run_trial4_benchmark_case';
/**
 * **P1, not P3.** Every other job in this queue that uses P2/P3 is
 * *automatically* triggered background persona-pipeline work, deliberately
 * gated to BACKGROUND/DEEP_IDLE mode so it never contends with an actively
 * working operator (`ALLOWED_PRIORITIES_BY_MODE`,
 * `src/governor/mode-priorities.ts`). This job is the opposite kind of
 * thing: an explicit, one-shot action the operator triggers by clicking
 * "Run next case" on the Dashboard's open Benchmark page, expecting to see
 * the result appear within the next poll tick. DEEP_IDLE requires
 * `foregroundActive === false` (`decideMode`,
 * `src/governor/resource-governor.ts`) — but the Dashboard tab keeps a
 * foreground port connected (`FOREGROUND_PORT_NAME`) for as long as it is
 * open, so `foregroundActive` is `true` for the entire time the operator
 * could possibly be there to click this button. A P3 assignment here was a
 * real bug: the mode this job needed to dispatch could structurally never
 * occur while anyone was present to trigger it — "Run next case" would
 * enqueue a job that silently never ran, no request was ever sent to any
 * model, until the operator closed the Dashboard and stayed away for 90+
 * seconds. P1 is allowed under INTERACTIVE (`ALLOWED_PRIORITIES_BY_MODE`),
 * so the next `hdna-dispatch` alarm tick (`background.ts`, every 30s) runs
 * it regardless of foreground state.
 */
export const RUN_TRIAL4_BENCHMARK_CASE_PRIORITY: JobPriority = 'P1';

export function enqueueTrial4BenchmarkCase(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(RUN_TRIAL4_BENCHMARK_CASE_JOB, RUN_TRIAL4_BENCHMARK_CASE_PRIORITY, {});
}

/**
 * Manually-triggered-only Trial 4 blind-benchmark run, one held-out case
 * per job — mirrors Trial 3's per-source job shape
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
