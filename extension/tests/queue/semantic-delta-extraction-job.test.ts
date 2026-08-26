import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import {
  EXTRACT_SEMANTIC_DELTAS_JOB,
  createExtractSemanticDeltasProcessor,
  enqueueSemanticDeltaExtraction,
} from '../../src/queue/processors/semantic-delta-extraction-job';
import type { SemanticDeltaExtractionService } from '../../src/persona/semantic-delta-extraction-service';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const runExperiment = vi.fn(async () => []);
  const service = { runExperiment } as unknown as SemanticDeltaExtractionService;
  queue.registerProcessor(EXTRACT_SEMANTIC_DELTAS_JOB, createExtractSemanticDeltasProcessor(service));
  return { queue, runExperiment };
}

describe('extract_semantic_deltas job', () => {
  it('is enqueued as P3', async () => {
    const { queue } = setup();
    await enqueueSemanticDeltaExtraction(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('invokes service.runExperiment() exactly once when run', async () => {
    const { queue, runExperiment } = setup();
    await enqueueSemanticDeltaExtraction(queue);

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    expect(runExperiment).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated triggers into a single outstanding job, and allows a new one after completion', async () => {
    const { queue } = setup();
    const first = await enqueueSemanticDeltaExtraction(queue);
    for (let i = 0; i < 10; i += 1) await enqueueSemanticDeltaExtraction(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });

    const completed = await queue.runNext();
    expect(completed?.id).toBe((first as { id: string }).id);
    expect(completed?.status).toBe('COMPLETE');

    const after = await enqueueSemanticDeltaExtraction(queue);
    expect((after as { id: string }).id).not.toBe((first as { id: string }).id);
  });
});
