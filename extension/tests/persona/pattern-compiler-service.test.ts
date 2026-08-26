import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { EditMetricsStore } from '../../src/persona/edit-metrics-store';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { TraitScoreStore } from '../../src/persona/trait-score-store';
import { WritingSampleStore } from '../../src/persona/sample-store';
import { PatternStore } from '../../src/persona/pattern-store';
import { PatternCompilerService } from '../../src/persona/pattern-compiler-service';
import type { PatternCompilerPolicy } from '@spec/schema/pattern-compiler-policy';

const LOOSE_POLICY: PatternCompilerPolicy = { minSampleCount: 1, minConfidenceWeight: 0.1 };

function setup(policy = LOOSE_POLICY) {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const editMetricsStore = new EditMetricsStore(storage);
  const editEventStore = new EditEventStore(storage);
  const traitScoreStore = new TraitScoreStore(storage);
  const sampleStore = new WritingSampleStore(storage);
  const patternStore = new PatternStore(storage);
  const service = new PatternCompilerService(
    editMetricsStore,
    editEventStore,
    traitScoreStore,
    sampleStore,
    patternStore,
    policy,
  );
  return { storage, editMetricsStore, editEventStore, traitScoreStore, sampleStore, patternStore, service };
}

describe('PatternCompilerService.compile', () => {
  it('resolves an EditMetrics observation to its EditEvent context bucket', async () => {
    const { editEventStore, editMetricsStore, patternStore, service } = setup();
    const event = await editEventStore.add('ai text', 'edited text', { surface: 'public_social' });
    await editMetricsStore.put({
      editEventId: event.id,
      editDistance: 3,
      compressionRatio: 1.1,
      sentenceCountChange: 0,
      lexicalOverlap: 0.8,
      computedAt: '2026-01-01T00:00:00.000Z',
    });

    await service.compile();
    await expect(patternStore.get('lexicalOverlap', 'public_social')).resolves.toMatchObject({ value: 0.8 });
  });

  it('buckets evidence with no recorded context as "unscoped"', async () => {
    const { editEventStore, editMetricsStore, patternStore, service } = setup();
    const event = await editEventStore.add('ai text', 'edited text');
    await editMetricsStore.put({
      editEventId: event.id,
      editDistance: 3,
      compressionRatio: 1.1,
      sentenceCountChange: 0,
      lexicalOverlap: 0.5,
      computedAt: '2026-01-01T00:00:00.000Z',
    });

    await service.compile();
    await expect(patternStore.get('lexicalOverlap', 'unscoped')).resolves.toMatchObject({ value: 0.5 });
  });

  it('resolves a TraitScoreRecord observation to its writing-sample context bucket', async () => {
    const { storage, sampleStore, traitScoreStore, patternStore, service } = setup();
    const sample = await sampleStore.addSample('a sample', { surface: 'private_message' });
    await storage.putMany([
      traitScoreStore.entryFor({
        sourceId: sample.id,
        sourceType: 'writing_sample',
        scores: { formality: 0.7 },
        confidence: { formality: 1 },
        extractorId: 'heuristic-lexical',
        extractorVersion: '1.0.0',
        computedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);

    await service.compile();
    await expect(patternStore.get('formality', 'private_message')).resolves.toMatchObject({ value: 0.7 });
  });

  it('does not compile a pattern below the configured evidence threshold', async () => {
    const strictPolicy: PatternCompilerPolicy = { minSampleCount: 5, minConfidenceWeight: 0.1 };
    const { storage, sampleStore, traitScoreStore, patternStore, service } = setup(strictPolicy);
    const sample = await sampleStore.addSample('a sample');
    await storage.putMany([
      traitScoreStore.entryFor({
        sourceId: sample.id,
        sourceType: 'writing_sample',
        scores: { formality: 0.7 },
        confidence: { formality: 1 },
        extractorId: 'heuristic-lexical',
        extractorVersion: '1.0.0',
        computedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);

    await service.compile();
    await expect(patternStore.list()).resolves.toEqual([]);
  });

  it('discards a stale pattern that no longer has supporting evidence when recompiled', async () => {
    const { patternStore, service } = setup();
    await patternStore.put({
      dimension: 'formality',
      context: 'unscoped',
      value: 0.1,
      confidenceWeight: 5,
      sampleCount: 5,
      supportingRecordIds: ['stale'],
      compilerId: 'old-compiler',
      compilerVersion: '0.0.1',
      computedAt: '2020-01-01T00:00:00.000Z',
    });

    await service.compile();
    await expect(patternStore.list()).resolves.toEqual([]);
  });

  it('records supporting evidence ids for compiled patterns', async () => {
    const { editEventStore, editMetricsStore, patternStore, service } = setup();
    const event = await editEventStore.add('ai text', 'edited text');
    await editMetricsStore.put({
      editEventId: event.id,
      editDistance: 3,
      compressionRatio: 1.1,
      sentenceCountChange: 0,
      lexicalOverlap: 0.5,
      computedAt: '2026-01-01T00:00:00.000Z',
    });

    await service.compile();
    const pattern = await patternStore.get('lexicalOverlap', 'unscoped');
    expect(pattern?.supportingRecordIds).toEqual([`edit_event:${event.id}`]);
  });
});
