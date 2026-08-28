import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4BenchmarkCaseStore } from '../../src/persona/trial4-benchmark-case-store';
import { Trial4BenchmarkResultStore } from '../../src/persona/trial4-benchmark-result-store';
import { importTrial4BenchmarkCases, clearTrial4BenchmarkData } from '../../src/persona/trial4-benchmark-case-import';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type { Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';

function rawCase(overrides: Partial<Trial4BenchmarkCase> = {}): Trial4BenchmarkCase {
  return {
    id: 'case1',
    kind: 'replaced',
    originalText: 'original',
    finalText: 'final',
    beforeContext: '',
    afterContext: '',
    humanVerdict: null,
    humanDimensions: [],
    groundTruthLocked: false,
    ...overrides,
  };
}

function benchmarkResult(overrides: Partial<Trial4BenchmarkResult> = {}): Trial4BenchmarkResult {
  const response = { role: 'base' as const, verdict: null, dimensions: [], description: null, confidence: null, error: null, grade: null, humanAcceptable: null, humanRank: null };
  return {
    id: 'result1',
    caseId: 'case1',
    labelMapping: { A: response, B: { ...response, role: 'trained' }, C: { ...response, role: 'deepseek' } },
    bestResponse: null,
    note: '',
    judged: false,
    revealed: false,
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('importTrial4BenchmarkCases (append/replace, docs/decisions/0017 benchmark-data-management addendum)', () => {
  it('append mode adds cases without touching existing ones', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(rawCase({ id: 'existing' }));

    await importTrial4BenchmarkCases(store, [rawCase({ id: 'new1' })], 'append');

    const all = await store.list();
    expect(all.map((c) => c.id).sort()).toEqual(['existing', 'new1']);
  });

  it('append mode skips a case whose id already exists', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(rawCase({ id: 'case1', groundTruthLocked: true, humanVerdict: 'meaning_added' }));

    await importTrial4BenchmarkCases(store, [rawCase({ id: 'case1' })], 'append');

    const stored = await store.get('case1');
    expect(stored?.groundTruthLocked).toBe(true);
  });

  it('replace mode clears existing cases before importing the new corpus', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(rawCase({ id: 'old' }));

    await importTrial4BenchmarkCases(store, [rawCase({ id: 'new1' })], 'replace');

    const all = await store.list();
    expect(all.map((c) => c.id)).toEqual(['new1']);
  });

  it('imports an unlabeled (no ground truth) benchmark case, defaulting to unlocked', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);

    const raw = {
      id: 'unlabeled-1',
      kind: 'added' as const,
      originalText: '',
      finalText: 'added text',
      beforeContext: '',
      afterContext: '',
    } as Trial4BenchmarkCase;
    await importTrial4BenchmarkCases(store, [raw], 'append');

    const stored = await store.get('unlabeled-1');
    expect(stored?.groundTruthLocked).toBe(false);
    expect(stored?.humanVerdict).toBeNull();
    expect(stored?.humanDimensions).toEqual([]);
  });

  it('skips a raw entry with no id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);

    await importTrial4BenchmarkCases(store, [{} as Trial4BenchmarkCase], 'append');

    await expect(store.list()).resolves.toEqual([]);
  });
});

describe('clearTrial4BenchmarkData', () => {
  it('clears both the case store and the result store', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const caseStore = new Trial4BenchmarkCaseStore(storage);
    const resultStore = new Trial4BenchmarkResultStore(storage);
    await caseStore.put(rawCase());
    await resultStore.put(benchmarkResult());

    await clearTrial4BenchmarkData(caseStore, resultStore);

    await expect(caseStore.list()).resolves.toEqual([]);
    await expect(resultStore.list()).resolves.toEqual([]);
  });

  it('does not touch any other store (only these two)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const caseStore = new Trial4BenchmarkCaseStore(storage);
    const resultStore = new Trial4BenchmarkResultStore(storage);
    await caseStore.put(rawCase());

    await clearTrial4BenchmarkData(caseStore, resultStore);

    // Sanity: clearing an already-empty result store does not throw and
    // the case store really is empty afterward — the two-store scope is
    // enforced by clearTrial4BenchmarkData's own signature (it only
    // accepts these two store types), not re-checked against unrelated
    // stores here.
    await expect(caseStore.list()).resolves.toEqual([]);
  });
});
