import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { TraitScoreStore } from '../../src/persona/trait-score-store';
import type { TraitScoreRecord } from '@spec/schema/trait-score';

function record(overrides: Partial<TraitScoreRecord> = {}): TraitScoreRecord {
  return {
    sourceId: 's1',
    sourceType: 'writing_sample',
    scores: { formality: 0.5 },
    confidence: { formality: 1 },
    extractorId: 'heuristic-lexical',
    extractorVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TraitScoreStore', () => {
  it('round-trips a record through put (via entryFor + storage.putMany) and get', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitScoreStore(storage);
    const r = record();

    await storage.putMany([store.entryFor(r)]);
    await expect(store.get(r.sourceType, r.sourceId)).resolves.toEqual(r);
  });

  it('returns undefined for an unknown source', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitScoreStore(storage);
    await expect(store.get('writing_sample', 'missing')).resolves.toBeUndefined();
  });

  it('lists every stored record', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitScoreStore(storage);
    await storage.putMany([store.entryFor(record({ sourceId: 'a' })), store.entryFor(record({ sourceId: 'b' }))]);

    const all = await store.list();
    expect(all.map((r) => r.sourceId).sort()).toEqual(['a', 'b']);
  });

  it('clears every stored record', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitScoreStore(storage);
    await storage.putMany([store.entryFor(record({ sourceId: 'a' }))]);

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('classifies records as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitScoreStore(storage);
    await storage.putMany([store.entryFor(record())]);

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });
});
