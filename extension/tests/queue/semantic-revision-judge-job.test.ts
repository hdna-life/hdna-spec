import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import {
  JUDGE_SEMANTIC_REVISIONS_JOB,
  createJudgeSemanticRevisionsProcessor,
  enqueueSemanticRevisionJudge,
} from '../../src/queue/processors/semantic-revision-judge-job';
import type { SemanticRevisionJudgeExtractionService } from '../../src/persona/semantic-revision-judge-extraction-service';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const runExperiment = vi.fn(async () => ({ candidates: [], stats: {} }));
  const service = { runExperiment } as unknown as SemanticRevisionJudgeExtractionService;
  queue.registerProcessor(JUDGE_SEMANTIC_REVISIONS_JOB, createJudgeSemanticRevisionsProcessor(service));
  return { queue, runExperiment };
}

describe('judge_semantic_revisions job', () => {
  it('is enqueued as P3', async () => {
    const { queue } = setup();
    await enqueueSemanticRevisionJudge(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('invokes service.runExperiment() exactly once when run', async () => {
    const { queue, runExperiment } = setup();
    await enqueueSemanticRevisionJudge(queue);

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    expect(runExperiment).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated triggers into a single outstanding job, and allows a new one after completion', async () => {
    const { queue } = setup();
    const first = await enqueueSemanticRevisionJudge(queue);
    for (let i = 0; i < 10; i += 1) await enqueueSemanticRevisionJudge(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });

    const completed = await queue.runNext();
    expect(completed?.id).toBe((first as { id: string }).id);
    expect(completed?.status).toBe('COMPLETE');

    const after = await enqueueSemanticRevisionJudge(queue);
    expect((after as { id: string }).id).not.toBe((first as { id: string }).id);
  });

  it('is a distinct job name from Trial 0-2\'s extract_semantic_deltas job', async () => {
    expect(JUDGE_SEMANTIC_REVISIONS_JOB).toBe('judge_semantic_revisions');
    expect(JUDGE_SEMANTIC_REVISIONS_JOB).not.toBe('extract_semantic_deltas');
  });
});
