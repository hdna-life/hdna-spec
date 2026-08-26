import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { TraitScoreStore } from '../../src/persona/trait-score-store';
import { T2ProfileStore } from '../../src/persona/t2-profile-store';
import { TraitClassifierService } from '../../src/persona/trait-classifier-service';
import { HeuristicTinyClassifier } from '../../src/persona/t2-classifier';
import type { EmbeddingSource } from '../../src/persona/embedding-sources';

function fakeSource(sourceType: string, items: { id: string; text: string }[]): EmbeddingSource {
  return { sourceType, async list() { return items; } };
}

function setup(sources: EmbeddingSource[] = []) {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const traitScoreStore = new TraitScoreStore(storage);
  const profileStore = new T2ProfileStore(storage);
  const service = new TraitClassifierService(storage, new HeuristicTinyClassifier(), traitScoreStore, profileStore, sources);
  return { storage, traitScoreStore, profileStore, service };
}

describe('TraitClassifierService.classifyOne', () => {
  it('computes and stores a trait score, folding it into the profile', async () => {
    const { traitScoreStore, profileStore, service } = setup();
    await service.classifyOne('writing_sample', 's1', 'This is an ordinary test sentence for classification purposes.');

    const record = await traitScoreStore.get('writing_sample', 's1');
    expect(record?.profileAppliedAt).toBeDefined();
    expect(record?.scores.formality).toBeDefined();

    const profile = await profileStore.get();
    expect(profile?.formality?.sampleCount).toBe(1);
  });

  it('is idempotent: running it twice for the same source does not double-count', async () => {
    const { profileStore, service } = setup();
    await service.classifyOne('writing_sample', 's1', 'A perfectly ordinary sentence here.');
    await service.classifyOne('writing_sample', 's1', 'A perfectly ordinary sentence here.');

    const profile = await profileStore.get();
    expect(profile?.formality?.sampleCount).toBe(1);
  });

  it('treats a pre-existing profileAppliedAt receipt as already-processed', async () => {
    const { storage, traitScoreStore, profileStore, service } = setup();
    const priorProfile = { formality: { weightedMeanScore: 0.9, totalConfidenceWeight: 1, sampleCount: 1 }, updatedAt: '2026-01-01T00:00:00.000Z' };
    await storage.putMany([
      traitScoreStore.entryFor({
        sourceId: 's1',
        sourceType: 'writing_sample',
        scores: { formality: 0.9 },
        confidence: { formality: 1 },
        extractorId: 'heuristic-lexical',
        extractorVersion: '1.0.0',
        computedAt: '2026-01-01T00:00:00.000Z',
        profileAppliedAt: '2026-01-01T00:00:00.000Z',
      }),
      profileStore.entryFor(priorProfile),
    ]);

    await service.classifyOne('writing_sample', 's1', 'irrelevant text — should be skipped as already applied');
    await expect(profileStore.get()).resolves.toEqual(priorProfile);
  });
});

describe('TraitClassifierService.rebuild', () => {
  it('discards existing trait scores/profile and recomputes from every registered source', async () => {
    const sources = [fakeSource('writing_sample', [{ id: 's1', text: 'first sample text here' }, { id: 's2', text: 'second sample text here' }])];
    const { traitScoreStore, profileStore, service } = setup(sources);

    const count = await service.rebuild();
    expect(count).toBe(2);

    const all = await traitScoreStore.list();
    expect(all.map((r) => r.sourceId).sort()).toEqual(['s1', 's2']);

    const profile = await profileStore.get();
    expect(profile?.formality?.sampleCount).toBe(2);
  });

  it('does not let a stale trait score survive a rebuild', async () => {
    const sources = [fakeSource('writing_sample', [{ id: 's1', text: 'current text' }])];
    const { storage, traitScoreStore, service } = setup(sources);

    await storage.putMany([
      traitScoreStore.entryFor({
        sourceId: 'stale',
        sourceType: 'writing_sample',
        scores: { formality: 0.1 },
        confidence: { formality: 1 },
        extractorId: 'old-extractor',
        extractorVersion: '0.0.0',
        computedAt: '2020-01-01T00:00:00.000Z',
      }),
    ]);

    await service.rebuild();
    const all = await traitScoreStore.list();
    expect(all.map((r) => r.sourceId)).toEqual(['s1']);
  });
});
