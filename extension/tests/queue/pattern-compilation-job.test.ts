import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { EditMetricsStore } from '../../src/persona/edit-metrics-store';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { TraitScoreStore } from '../../src/persona/trait-score-store';
import { WritingSampleStore } from '../../src/persona/sample-store';
import { PatternStore } from '../../src/persona/pattern-store';
import { PatternCompilerService } from '../../src/persona/pattern-compiler-service';
import {
  COMPILE_PATTERNS_JOB,
  createCompilePatternsProcessor,
  enqueuePatternCompilation,
} from '../../src/queue/processors/pattern-compilation-job';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const editEventStore = new EditEventStore(storage);
  const editMetricsStore = new EditMetricsStore(storage);
  const patternStore = new PatternStore(storage);
  const service = new PatternCompilerService(
    editMetricsStore,
    editEventStore,
    new TraitScoreStore(storage),
    new WritingSampleStore(storage),
    patternStore,
    { minSampleCount: 1, minConfidenceWeight: 0.1 },
  );
  queue.registerProcessor(COMPILE_PATTERNS_JOB, createCompilePatternsProcessor(service));
  return { queue, editEventStore, editMetricsStore, patternStore };
}

describe('compile_patterns job', () => {
  it('is enqueued as P3', async () => {
    const { queue } = setup();
    await enqueuePatternCompilation(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('compiles patterns from current evidence when run', async () => {
    const { queue, editEventStore, editMetricsStore, patternStore } = setup();
    const event = await editEventStore.add('ai text', 'edited text');
    await editMetricsStore.put({
      editEventId: event.id,
      editDistance: 3,
      compressionRatio: 1.1,
      sentenceCountChange: 0,
      lexicalOverlap: 0.6,
      computedAt: '2026-01-01T00:00:00.000Z',
    });

    await enqueuePatternCompilation(queue);
    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');

    await expect(patternStore.get('lexicalOverlap', 'unscoped')).resolves.toMatchObject({ value: 0.6 });
  });

  it('coalesces repeated clicks into a single outstanding job, and allows a new one after completion', async () => {
    const { queue } = setup();
    const first = await enqueuePatternCompilation(queue);
    for (let i = 0; i < 10; i += 1) await enqueuePatternCompilation(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });

    const completed = await queue.runNext();
    expect(completed?.id).toBe((first as { id: string }).id);
    expect(completed?.status).toBe('COMPLETE');

    const after = await enqueuePatternCompilation(queue);
    expect((after as { id: string }).id).not.toBe((first as { id: string }).id);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });
});
