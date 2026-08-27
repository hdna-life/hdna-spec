import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { SemanticDeltaExtractionService } from '../../persona/semantic-delta-extraction-service';

export const EXTRACT_SEMANTIC_DELTAS_JOB = 'extract_semantic_deltas';
export const EXTRACT_SEMANTIC_DELTAS_PRIORITY: JobPriority = 'P3';

export function enqueueSemanticDeltaExtraction(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(EXTRACT_SEMANTIC_DELTAS_JOB, EXTRACT_SEMANTIC_DELTAS_PRIORITY, {});
}

/** P3: expensive/rare, manually-triggered-only Phase 5A semantic delta extraction over the real EditEvent corpus. */
export function createExtractSemanticDeltasProcessor(service: SemanticDeltaExtractionService): JobProcessor<unknown> {
  return async () => {
    await service.runExperiment();
  };
}
