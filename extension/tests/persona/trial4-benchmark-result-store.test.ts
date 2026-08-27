import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4BenchmarkResultStore } from '../../src/persona/trial4-benchmark-result-store';
import type { Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';

function benchmarkResult(overrides: Partial<Trial4BenchmarkResult> = {}): Trial4BenchmarkResult {
  return {
    id: 'result1',
    caseId: 'case1',
    labelMapping: {
      A: {
        role: 'base',
        verdict: 'meaning_added',
        description: 'Text added.',
        confidence: 0.8,
        error: null,
        grade: null,
      },
      B: {
        role: 'trained',
        verdict: 'meaning_added',
        description: 'Text added.',
        confidence: 0.75,
        error: null,
        grade: null,
      },
      C: {
        role: 'deepseek',
        verdict: 'meaning_added',
        description: 'Text added.',
        confidence: 0.9,
        error: null,
        grade: null,
      },
    },
    bestResponse: null,
    note: '',
    judged: false,
    revealed: false,
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Trial4BenchmarkResultStore', () => {
  it('round-trips a result through put/get, keyed by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    const r = benchmarkResult();

    await store.put(r);
    await expect(store.get(r.id)).resolves.toEqual(r);
  });

  it('lists every stored result', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    await store.put(benchmarkResult({ id: 'r1' }));
    await store.put(benchmarkResult({ id: 'r2' }));

    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('clears every stored result', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    await store.put(benchmarkResult());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores results as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    await store.put(benchmarkResult());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });

  it('stores a result with judgedAt absent (not yet judged)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    const r = benchmarkResult();
    expect(r.judgedAt).toBeUndefined();

    await store.put(r);
    const stored = await store.get(r.id);
    expect(stored?.judgedAt).toBeUndefined();
  });

  it('stores a result with judgedAt present (judged)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    const r = benchmarkResult({ judgedAt: '2026-01-02T00:00:00.000Z' });

    await store.put(r);
    const stored = await store.get(r.id);
    expect(stored?.judgedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('stores a result with a provider error (verdict/description/confidence all null)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4BenchmarkResultStore(storage);
    const r = benchmarkResult({
      labelMapping: {
        A: {
          role: 'base',
          verdict: null,
          description: null,
          confidence: null,
          error: 'Local MLX server unreachable',
          grade: null,
        },
        B: {
          role: 'trained',
          verdict: null,
          description: null,
          confidence: null,
          error: 'Local MLX server unreachable',
          grade: null,
        },
        C: {
          role: 'deepseek',
          verdict: 'meaning_added',
          description: 'Text added.',
          confidence: 0.9,
          error: null,
          grade: null,
        },
      },
    });

    await store.put(r);
    const stored = await store.get(r.id);
    expect(stored?.labelMapping.A.error).toBe('Local MLX server unreachable');
    expect(stored?.labelMapping.A.verdict).toBeNull();
  });
});
