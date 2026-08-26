import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { SemanticRevisionJudgeExtractionService } from '../../persona/semantic-revision-judge-extraction-service';

export const JUDGE_SEMANTIC_REVISIONS_JOB = 'judge_semantic_revisions';
export const JUDGE_SEMANTIC_REVISIONS_PRIORITY: JobPriority = 'P3';

export function enqueueSemanticRevisionJudge(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(JUDGE_SEMANTIC_REVISIONS_JOB, JUDGE_SEMANTIC_REVISIONS_PRIORITY, {});
}

/** P3: expensive/rare, manually-triggered-only Phase 5A Trial 3 semantic revision judging over the real EditEvent corpus. */
export function createJudgeSemanticRevisionsProcessor(
  service: SemanticRevisionJudgeExtractionService,
): JobProcessor<unknown> {
  return async () => {
    await service.runExperiment();
  };
}
