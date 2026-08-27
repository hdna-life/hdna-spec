import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { SemanticDeltaCandidateStore } from '../../src/persona/semantic-delta-candidate-store';
import type { SemanticDeltaCandidate } from '@spec/schema/semantic-delta-candidate';

function candidate(overrides: Partial<SemanticDeltaCandidate> = {}): SemanticDeltaCandidate {
  return {
    id: 'c1',
    sourceEvidenceId: 'edit_event:e1',
    kind: 'behavioral_delta',
    observation: 'adds an explicit recommendation',
    context: 'unscoped',
    confidence: 0.7,
    extractorId: 'openrouter',
    extractorVersion: 'openai/gpt-4o-mini',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SemanticDeltaCandidateStore', () => {
  it('round-trips a candidate through put/get, keyed by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaCandidateStore(storage);
    const c = candidate();

    await store.put(c);
    await expect(store.get(c.id)).resolves.toEqual(c);
  });

  it('lists every stored candidate', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaCandidateStore(storage);
    await store.put(candidate({ id: 'c1' }));
    await store.put(candidate({ id: 'c2' }));

    const all = await store.list();
    expect(all.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('clears every stored candidate', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaCandidateStore(storage);
    await store.put(candidate());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores candidates as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaCandidateStore(storage);
    await store.put(candidate());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });

  it('accepts a candidate with preferred/rejected absent (observation-centered, non-contrastive)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaCandidateStore(storage);
    const c = candidate();
    expect(c.preferred).toBeUndefined();
    expect(c.rejected).toBeUndefined();

    await store.put(c);
    const stored = await store.get(c.id);
    expect(stored?.preferred).toBeUndefined();
    expect(stored?.rejected).toBeUndefined();
  });

  it('never contains raw evidence text fields (sourceText/finalText) — only the model-derived observation', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaCandidateStore(storage);
    await store.put(candidate());

    const stored = await store.get('c1');
    expect(stored).not.toHaveProperty('sourceText');
    expect(stored).not.toHaveProperty('finalText');
    expect(stored).not.toHaveProperty('apiKey');
  });
});
