import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { PatternStore } from '../../src/persona/pattern-store';
import type { Pattern } from '@spec/schema/pattern';

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    dimension: 'formality',
    context: 'unscoped',
    value: 0.5,
    confidenceWeight: 3,
    sampleCount: 3,
    supportingRecordIds: ['a', 'b', 'c'],
    compilerId: 'deterministic-aggregate',
    compilerVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PatternStore', () => {
  it('round-trips a pattern through put/get, keyed by dimension:context', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new PatternStore(storage);
    const p = pattern();

    await store.put(p);
    await expect(store.get(p.dimension, p.context)).resolves.toEqual(p);
  });

  it('keeps patterns for different contexts distinct', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new PatternStore(storage);
    await store.put(pattern({ context: 'public', value: 0.9 }));
    await store.put(pattern({ context: 'private', value: 0.1 }));

    await expect(store.get('formality', 'public')).resolves.toMatchObject({ value: 0.9 });
    await expect(store.get('formality', 'private')).resolves.toMatchObject({ value: 0.1 });
  });

  it('lists every stored pattern', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new PatternStore(storage);
    await store.put(pattern({ dimension: 'formality' }));
    await store.put(pattern({ dimension: 'directness' }));

    const all = await store.list();
    expect(all.map((p) => p.dimension).sort()).toEqual(['directness', 'formality']);
  });

  it('clears every stored pattern', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new PatternStore(storage);
    await store.put(pattern());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores patterns as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new PatternStore(storage);
    await store.put(pattern());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });
});
