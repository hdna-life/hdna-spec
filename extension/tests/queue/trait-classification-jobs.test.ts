import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { WritingSampleStore } from '../../src/persona/sample-store';
import { TraitScoreStore } from '../../src/persona/trait-score-store';
import { T2ProfileStore } from '../../src/persona/t2-profile-store';
import { TraitClassifierService } from '../../src/persona/trait-classifier-service';
import { HeuristicTinyClassifier } from '../../src/persona/t2-classifier';
import { writingSampleSource } from '../../src/persona/embedding-sources';
import {
  CLASSIFY_EVIDENCE_JOB,
  REBUILD_T2_PROFILE_JOB,
  createClassifyEvidenceProcessor,
  createRebuildT2ProfileProcessor,
  enqueueEvidenceClassification,
  enqueueT2ProfileRebuild,
} from '../../src/queue/processors/trait-classification-jobs';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const sampleStore = new WritingSampleStore(storage);
  const profileStore = new T2ProfileStore(storage);
  const service = new TraitClassifierService(storage, new HeuristicTinyClassifier(), new TraitScoreStore(storage), profileStore, [
    writingSampleSource(sampleStore),
  ]);
  queue.registerProcessor(CLASSIFY_EVIDENCE_JOB, createClassifyEvidenceProcessor(service));
  queue.registerProcessor(REBUILD_T2_PROFILE_JOB, createRebuildT2ProfileProcessor(service));
  return { queue, sampleStore, profileStore };
}

describe('classify_evidence job', () => {
  it('is enqueued as P2', async () => {
    const { queue } = setup();
    await enqueueEvidenceClassification(queue, 'writing_sample', 's1', 'hello');
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P2: 1 });
  });

  it('classifies and folds into the T2 profile when run', async () => {
    const { queue, profileStore } = setup();
    await enqueueEvidenceClassification(queue, 'writing_sample', 's1', 'a perfectly ordinary sentence here');

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    await expect(profileStore.get()).resolves.toMatchObject({ formality: { sampleCount: 1 } });
  });
});

describe('rebuild_t2_profile job', () => {
  it('is enqueued as P3', async () => {
    const { queue } = setup();
    await enqueueT2ProfileRebuild(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('rebuilds the profile from every registered canonical source when run', async () => {
    const { queue, sampleStore, profileStore } = setup();
    await sampleStore.addSample('first sample text here');
    await sampleStore.addSample('second sample text here');
    await enqueueT2ProfileRebuild(queue);

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    await expect(profileStore.get()).resolves.toMatchObject({ formality: { sampleCount: 2 } });
  });

  it('coalesces repeated clicks into a single outstanding job, and allows a new one after completion', async () => {
    const { queue } = setup();
    const first = await enqueueT2ProfileRebuild(queue);
    for (let i = 0; i < 10; i += 1) await enqueueT2ProfileRebuild(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });

    const completed = await queue.runNext();
    expect(completed?.id).toBe((first as { id: string }).id);
    expect(completed?.status).toBe('COMPLETE');

    const after = await enqueueT2ProfileRebuild(queue);
    expect((after as { id: string }).id).not.toBe((first as { id: string }).id);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });
});
