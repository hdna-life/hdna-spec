import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { WritingSampleStore } from '../../src/persona/sample-store';
import { EmbeddingStore } from '../../src/persona/embedding-store';
import { VectorIndexService } from '../../src/persona/vector-index-service';
import { HashingEmbeddingProvider } from '../../src/persona/hashing-embedding-provider';
import { writingSampleSource } from '../../src/persona/embedding-sources';
import {
  INDEX_EMBEDDING_JOB,
  REBUILD_VECTOR_INDEX_JOB,
  createIndexEmbeddingProcessor,
  createRebuildVectorIndexProcessor,
  enqueueEmbeddingIndex,
  enqueueVectorIndexRebuild,
} from '../../src/queue/processors/embedding-jobs';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const sampleStore = new WritingSampleStore(storage);
  const embeddingStore = new EmbeddingStore(storage);
  const indexService = new VectorIndexService(new HashingEmbeddingProvider(), embeddingStore, [
    writingSampleSource(sampleStore),
  ]);
  queue.registerProcessor(INDEX_EMBEDDING_JOB, createIndexEmbeddingProcessor(indexService));
  queue.registerProcessor(REBUILD_VECTOR_INDEX_JOB, createRebuildVectorIndexProcessor(indexService));
  return { queue, sampleStore, embeddingStore, indexService };
}

describe('index_embedding job', () => {
  it('is enqueued as P2', async () => {
    const { queue } = setup();
    await enqueueEmbeddingIndex(queue, 'writing_sample', 's1', 'hello');
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P2: 1 });
  });

  it('computes and stores the embedding when run', async () => {
    const { queue, embeddingStore } = setup();
    await enqueueEmbeddingIndex(queue, 'writing_sample', 's1', 'hello world');

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    await expect(embeddingStore.get('writing_sample', 's1')).resolves.toBeDefined();
  });
});

describe('rebuild_vector_index job', () => {
  it('is enqueued as P3', async () => {
    const { queue } = setup();
    await enqueueVectorIndexRebuild(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('rebuilds the index from every registered canonical source when run', async () => {
    const { queue, sampleStore, embeddingStore } = setup();
    await sampleStore.addSample('first sample');
    await sampleStore.addSample('second sample');
    await enqueueVectorIndexRebuild(queue);

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    await expect(embeddingStore.list()).resolves.toHaveLength(2);
  });
});
