import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { VectorIndexService } from '../../persona/vector-index-service';

export const INDEX_EMBEDDING_JOB = 'index_embedding';
export const REBUILD_VECTOR_INDEX_JOB = 'rebuild_vector_index';

export const INDEX_EMBEDDING_PRIORITY: JobPriority = 'P2';
export const REBUILD_VECTOR_INDEX_PRIORITY: JobPriority = 'P3';

export interface IndexEmbeddingPayload {
  sourceType: string;
  sourceId: string;
  text: string;
}

/** Persist + enqueue only, per the same "return immediately, process later" pipeline as other capture paths. */
export function enqueueEmbeddingIndex(
  queue: JobQueue,
  sourceType: string,
  sourceId: string,
  text: string,
): Promise<unknown> {
  return queue.enqueue<IndexEmbeddingPayload>(INDEX_EMBEDDING_JOB, INDEX_EMBEDDING_PRIORITY, {
    sourceType,
    sourceId,
    text,
  });
}

export function enqueueVectorIndexRebuild(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(REBUILD_VECTOR_INDEX_JOB, REBUILD_VECTOR_INDEX_PRIORITY, {});
}

/** P2: compute and store one embedding. Recomputing/overwriting is harmless — embed() is a pure function of the text. */
export function createIndexEmbeddingProcessor(indexService: VectorIndexService): JobProcessor<IndexEmbeddingPayload> {
  return async ({ sourceType, sourceId, text }) => {
    await indexService.indexOne(sourceType, sourceId, text);
  };
}

/** P3: discard and fully rebuild the index from canonical evidence. Expensive/rare — matches the doc's P3 job class. */
export function createRebuildVectorIndexProcessor(indexService: VectorIndexService): JobProcessor<unknown> {
  return async () => {
    await indexService.rebuild();
  };
}
