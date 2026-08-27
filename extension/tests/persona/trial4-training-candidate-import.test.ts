import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4TrainingCandidateStore } from '../../src/persona/trial4-training-candidate-store';
import {
  importTrial4TrainingCandidates,
  clearAllTrial4TrainingCandidates,
} from '../../src/persona/trial4-training-candidate-import';
import { Trial4BenchmarkCaseStore } from '../../src/persona/trial4-benchmark-case-store';
import { Trial4BenchmarkResultStore } from '../../src/persona/trial4-benchmark-result-store';
import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type { Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';

function candidate(overrides: Partial<Trial4TrainingCandidate> = {}): Trial4TrainingCandidate {
  return {
    id: 'candidate1',
    kind: 'replaced',
    originalText: 'original text',
    finalText: 'final text',
    beforeContext: 'before context',
    afterContext: 'after context',
    proposedVerdict: 'meaning_added',
    proposedDescription: 'A change was made.',
    humanVerdict: null,
    includeInTraining: false,
    exclusionReasons: [],
    operatorNoteTr: '',
    loreImportant: false,
    loreNoteTr: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  return {
    storage,
    candidateStore: new Trial4TrainingCandidateStore(storage),
    benchmarkCaseStore: new Trial4BenchmarkCaseStore(storage),
    benchmarkResultStore: new Trial4BenchmarkResultStore(storage),
  };
}

const benchmarkCase: Trial4BenchmarkCase = {
  id: 'case1',
  kind: 'replaced',
  originalText: 'x',
  finalText: 'y',
  beforeContext: '',
  afterContext: '',
};

const benchmarkResult: Trial4BenchmarkResult = {
  id: 'result1',
  caseId: 'case1',
  labelMapping: {
    A: { role: 'base', verdict: null, description: null, confidence: null, error: null, grade: null },
    B: { role: 'trained', verdict: null, description: null, confidence: null, error: null, grade: null },
    C: { role: 'deepseek', verdict: null, description: null, confidence: null, error: null, grade: null },
  },
  bestResponse: null,
  note: '',
  judged: false,
  revealed: false,
  computedAt: '2026-01-01T00:00:00.000Z',
};

describe('clearAllTrial4TrainingCandidates (clear-only behavior)', () => {
  it('empties the training candidate store', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'c1' }));
    await ctx.candidateStore.put(candidate({ id: 'c2' }));

    await clearAllTrial4TrainingCandidates(ctx.candidateStore);

    await expect(ctx.candidateStore.list()).resolves.toEqual([]);
  });

  it('affects only trial4_training_candidates — benchmark cases/results are untouched', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate());
    await ctx.benchmarkCaseStore.put(benchmarkCase);
    await ctx.benchmarkResultStore.put(benchmarkResult);

    await clearAllTrial4TrainingCandidates(ctx.candidateStore);

    await expect(ctx.candidateStore.list()).resolves.toEqual([]);
    await expect(ctx.benchmarkCaseStore.list()).resolves.toEqual([benchmarkCase]);
    await expect(ctx.benchmarkResultStore.list()).resolves.toEqual([benchmarkResult]);
  });

  it('is a no-op (does not throw) when the store is already empty', async () => {
    const ctx = setup();
    await expect(clearAllTrial4TrainingCandidates(ctx.candidateStore)).resolves.toBeUndefined();
    await expect(ctx.candidateStore.list()).resolves.toEqual([]);
  });
});

describe('importTrial4TrainingCandidates — append mode (preserves existing behavior)', () => {
  it('preserves existing candidates and adds new ones', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'existing' }));

    await importTrial4TrainingCandidates(ctx.candidateStore, [candidate({ id: 'new1' })], 'append');

    const all = await ctx.candidateStore.list();
    expect(all.map((c) => c.id).sort()).toEqual(['existing', 'new1']);
  });

  it('skips candidates whose id already exists in the store', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'existing', operatorNoteTr: 'original note' }));

    await importTrial4TrainingCandidates(
      ctx.candidateStore,
      [candidate({ id: 'existing', operatorNoteTr: 'incoming note' })],
      'append',
    );

    const stored = await ctx.candidateStore.get('existing');
    expect(stored?.operatorNoteTr).toBe('original note');
  });

  it('applies review-field defaults to a raw/partial imported candidate', async () => {
    const ctx = setup();
    const raw = { ...candidate({ id: 'raw' }) };
    // @ts-expect-error simulating a freshly-generated candidate missing review fields
    delete raw.humanVerdict;
    // @ts-expect-error
    delete raw.includeInTraining;
    // @ts-expect-error
    delete raw.exclusionReasons;

    await importTrial4TrainingCandidates(ctx.candidateStore, [raw as Trial4TrainingCandidate], 'append');

    const stored = await ctx.candidateStore.get('raw');
    expect(stored?.humanVerdict).toBeNull();
    expect(stored?.includeInTraining).toBe(false);
    expect(stored?.exclusionReasons).toEqual([]);
  });
});

describe('importTrial4TrainingCandidates — replace mode (discard old corpus, start clean)', () => {
  it('discards the existing corpus and persists only the imported candidates', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'old1' }));
    await ctx.candidateStore.put(candidate({ id: 'old2' }));

    await importTrial4TrainingCandidates(ctx.candidateStore, [candidate({ id: 'new1' })], 'replace');

    const all = await ctx.candidateStore.list();
    expect(all.map((c) => c.id)).toEqual(['new1']);
  });

  it('does not skip an imported candidate whose id matches a previously-existing (now-cleared) one', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'shared-id', operatorNoteTr: 'old note' }));

    await importTrial4TrainingCandidates(
      ctx.candidateStore,
      [candidate({ id: 'shared-id', operatorNoteTr: 'new note' })],
      'replace',
    );

    const stored = await ctx.candidateStore.get('shared-id');
    expect(stored?.operatorNoteTr).toBe('new note');
  });

  it('results in an empty store when importing an empty candidate list', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'old1' }));

    await importTrial4TrainingCandidates(ctx.candidateStore, [], 'replace');

    await expect(ctx.candidateStore.list()).resolves.toEqual([]);
  });

  it('affects only trial4_training_candidates — benchmark cases/results survive a replace import', async () => {
    const ctx = setup();
    await ctx.candidateStore.put(candidate({ id: 'old1' }));
    await ctx.benchmarkCaseStore.put(benchmarkCase);
    await ctx.benchmarkResultStore.put(benchmarkResult);

    await importTrial4TrainingCandidates(ctx.candidateStore, [candidate({ id: 'new1' })], 'replace');

    await expect(ctx.benchmarkCaseStore.list()).resolves.toEqual([benchmarkCase]);
    await expect(ctx.benchmarkResultStore.list()).resolves.toEqual([benchmarkResult]);
  });

  it('applies review-field defaults to imported candidates just like append mode', async () => {
    const ctx = setup();
    const raw = { ...candidate({ id: 'raw' }) };
    // @ts-expect-error simulating a freshly-generated candidate missing review fields
    delete raw.loreImportant;
    // @ts-expect-error
    delete raw.loreNoteTr;

    await importTrial4TrainingCandidates(ctx.candidateStore, [raw as Trial4TrainingCandidate], 'replace');

    const stored = await ctx.candidateStore.get('raw');
    expect(stored?.loreImportant).toBe(false);
    expect(stored?.loreNoteTr).toBeNull();
  });

  it('sets a fresh importedAt timestamp for every imported candidate', async () => {
    const ctx = setup();
    const fixedNow = () => '2026-06-01T00:00:00.000Z';

    await importTrial4TrainingCandidates(
      ctx.candidateStore,
      [candidate({ id: 'new1', importedAt: '2020-01-01T00:00:00.000Z' })],
      'replace',
      fixedNow,
    );

    const stored = await ctx.candidateStore.get('new1');
    expect(stored?.importedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});
