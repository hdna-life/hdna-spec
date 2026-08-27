import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4TrainingCandidateStore } from '../../src/persona/trial4-training-candidate-store';
import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';

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

describe('Trial4TrainingCandidateStore', () => {
  it('round-trips a candidate through put/get, keyed by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    const c = candidate();

    await store.put(c);
    await expect(store.get(c.id)).resolves.toEqual(c);
  });

  it('lists every stored candidate', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    await store.put(candidate({ id: 'c1' }));
    await store.put(candidate({ id: 'c2' }));

    const all = await store.list();
    expect(all.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('clears every stored candidate', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    await store.put(candidate());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores candidates as CACHE', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    await store.put(candidate());

    const usage = await storage.usageByClass();
    expect(usage.CACHE).toBeGreaterThan(0);
  });

  it('never contains raw training-generation fields — only the model-derived verdict and description', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    await store.put(candidate());

    const stored = await store.get('candidate1');
    expect(stored).not.toHaveProperty('deepSeekApiKey');
    expect(stored).not.toHaveProperty('deepSeekModelId');
  });

  it('accepts a candidate with reviewedAt absent (pending decision)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    const c = candidate();
    expect(c.reviewedAt).toBeUndefined();

    await store.put(c);
    const stored = await store.get(c.id);
    expect(stored?.reviewedAt).toBeUndefined();
  });

  it('stores a candidate with reviewedAt present (included/excluded decision)', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new Trial4TrainingCandidateStore(storage);
    const c = candidate({
      humanVerdict: 'meaning_added',
      includeInTraining: true,
      reviewedAt: '2026-01-02T00:00:00.000Z',
    });

    await store.put(c);
    const stored = await store.get(c.id);
    expect(stored?.reviewedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
