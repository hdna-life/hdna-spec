import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4BenchmarkCaseStore, applyTrial4BenchmarkCaseDefaults } from '../../src/persona/trial4-benchmark-case-store';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';

function benchmarkCase(overrides: Partial<Trial4BenchmarkCase> = {}): Trial4BenchmarkCase {
  return {
    id: 'case1',
    kind: 'replaced',
    originalText: 'original text',
    finalText: 'final text',
    beforeContext: 'before context',
    afterContext: 'after context',
    humanVerdict: null,
    humanDimensions: [],
    groundTruthLocked: false,
    ...overrides,
  };
}

describe('Trial4BenchmarkCaseStore', () => {
  it('round-trips a benchmark case through put/get, keyed by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    const c = benchmarkCase();

    await store.put(c);
    await expect(store.get(c.id)).resolves.toEqual(c);
  });

  it('lists every stored benchmark case', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(benchmarkCase({ id: 'case1' }));
    await store.put(benchmarkCase({ id: 'case2' }));

    const all = await store.list();
    expect(all.map((c) => c.id).sort()).toEqual(['case1', 'case2']);
  });

  it('clears every stored benchmark case', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(benchmarkCase());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores benchmark cases as CACHE', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(benchmarkCase());

    const usage = await storage.usageByClass();
    expect(usage.CACHE).toBeGreaterThan(0);
  });

  it('stores only the benchmark case input (never result/judgment data)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(benchmarkCase());

    const stored = await store.get('case1');
    expect(stored).not.toHaveProperty('verdict');
    expect(stored).not.toHaveProperty('confidence');
    expect(stored).not.toHaveProperty('grade');
  });

  it('never contains any system identity or result annotation', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkCaseStore(storage);
    await store.put(benchmarkCase());

    const stored = await store.get('case1');
    expect(JSON.stringify(stored)).not.toMatch(/base|trained|deepseek/);
    expect(JSON.stringify(stored)).not.toMatch(/role|label/);
  });
});

describe('applyTrial4BenchmarkCaseDefaults (benchmark import, Test 1 evaluation-stage addendum)', () => {
  const RAW_CASE = {
    id: 'imported-1',
    kind: 'replaced' as const,
    originalText: 'x',
    finalText: 'y',
    beforeContext: '',
    afterContext: '',
  };

  it('defaults a raw case with no ground truth fields to unlocked/null/[]', () => {
    const result = applyTrial4BenchmarkCaseDefaults(RAW_CASE);
    expect(result.humanVerdict).toBeNull();
    expect(result.humanDimensions).toEqual([]);
    expect(result.groundTruthLocked).toBe(false);
    expect(result.groundTruthLockedAt).toBeUndefined();
  });

  it('does not require generated/proposed verdicts in imported benchmark files', () => {
    const result = applyTrial4BenchmarkCaseDefaults(RAW_CASE);
    expect(result).not.toHaveProperty('proposedVerdict');
    expect(result).not.toHaveProperty('expectedVerdict');
  });

  it('preserves a raw case that is already locked with valid ground truth', () => {
    const result = applyTrial4BenchmarkCaseDefaults({
      ...RAW_CASE,
      humanVerdict: 'meaning_added',
      humanDimensions: [{ dimension: 'certainty', direction: 'increased' }],
      groundTruthLocked: true,
      groundTruthLockedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.humanVerdict).toBe('meaning_added');
    expect(result.humanDimensions).toEqual([{ dimension: 'certainty', direction: 'increased' }]);
    expect(result.groundTruthLocked).toBe(true);
    expect(result.groundTruthLockedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('ignores a stale/legacy expectedVerdict-shaped field rather than treating it as locked ground truth', () => {
    const raw = { ...RAW_CASE, expectedVerdict: 'meaning_added', expectedDimensions: [] } as unknown as Parameters<
      typeof applyTrial4BenchmarkCaseDefaults
    >[0];
    const result = applyTrial4BenchmarkCaseDefaults(raw);
    expect(result.humanVerdict).toBeNull();
    expect(result.groundTruthLocked).toBe(false);
  });
});
