import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { TraitClassifierService } from '../../persona/trait-classifier-service';

export const CLASSIFY_EVIDENCE_JOB = 'classify_evidence';
export const REBUILD_T2_PROFILE_JOB = 'rebuild_t2_profile';

export const CLASSIFY_EVIDENCE_PRIORITY: JobPriority = 'P2';
export const REBUILD_T2_PROFILE_PRIORITY: JobPriority = 'P3';

export interface ClassifyEvidencePayload {
  sourceType: string;
  sourceId: string;
  text: string;
}

/** Persist + enqueue only, per the same "return immediately, process later" pipeline as other capture paths. */
export function enqueueEvidenceClassification(
  queue: JobQueue,
  sourceType: string,
  sourceId: string,
  text: string,
): Promise<unknown> {
  return queue.enqueue<ClassifyEvidencePayload>(CLASSIFY_EVIDENCE_JOB, CLASSIFY_EVIDENCE_PRIORITY, {
    sourceType,
    sourceId,
    text,
  });
}

export function enqueueT2ProfileRebuild(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(REBUILD_T2_PROFILE_JOB, REBUILD_T2_PROFILE_PRIORITY, {});
}

/** P2: classify one piece of evidence and fold it into T2Profile. Idempotent — see TraitClassifierService.classifyOne(). */
export function createClassifyEvidenceProcessor(service: TraitClassifierService): JobProcessor<ClassifyEvidencePayload> {
  return async ({ sourceType, sourceId, text }) => {
    await service.classifyOne(sourceType, sourceId, text);
  };
}

/** P3: discard and fully rebuild trait scores + the T2 profile from canonical evidence. Expensive/rare. */
export function createRebuildT2ProfileProcessor(service: TraitClassifierService): JobProcessor<unknown> {
  return async () => {
    await service.rebuild();
  };
}
