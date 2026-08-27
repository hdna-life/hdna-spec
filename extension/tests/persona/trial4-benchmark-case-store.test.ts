import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4BenchmarkCaseStore } from '../../src/persona/trial4-benchmark-case-store';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';

function benchmarkCase(overrides: Partial<Trial4BenchmarkCase> = {}): Trial4BenchmarkCase {
  return {
    id: 'case1',
    kind: 'replaced',
    originalText: 'original text',
    finalText: 'final text',
    beforeContext: 'before context',
    afterContext: 'after context',
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
