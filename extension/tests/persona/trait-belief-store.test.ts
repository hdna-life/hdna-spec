import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { TraitBeliefStore } from '../../src/persona/trait-belief-store';
import type { TraitBeliefClaim } from '@spec/schema/trait-belief';

function claim(overrides: Partial<TraitBeliefClaim> = {}): TraitBeliefClaim {
  return {
    id: 'claim-1',
    claim: 'prioritizes implementation simplicity',
    context: 'unscoped',
    confidence: 0.6,
    supportingPatternKeys: ['formality:unscoped'],
    interpreterId: 'openrouter',
    interpreterModelId: 'openai/gpt-4o-mini',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TraitBeliefStore', () => {
  it('round-trips a claim through put/get, keyed by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitBeliefStore(storage);
    const c = claim();

    await store.put(c);
    await expect(store.get(c.id)).resolves.toEqual(c);
  });

  it('lists every stored claim', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitBeliefStore(storage);
    await store.put(claim({ id: 'a' }));
    await store.put(claim({ id: 'b' }));

    const all = await store.list();
    expect(all.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('clears every stored claim', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitBeliefStore(storage);
    await store.put(claim());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores claims as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new TraitBeliefStore(storage);
    await store.put(claim());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });
});
