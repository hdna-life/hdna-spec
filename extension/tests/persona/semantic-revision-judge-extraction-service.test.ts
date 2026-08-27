import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { SemanticDeltaCandidateStore } from '../../src/persona/semantic-delta-candidate-store';
import { SemanticDeltaExtractionReceiptStore } from '../../src/persona/semantic-delta-extraction-receipt-store';
import { SemanticRevisionJudgeConfigStore } from '../../src/persona/semantic-revision-judge-config-store';
import { SemanticRevisionJudgeExtractionService } from '../../src/persona/semantic-revision-judge-extraction-service';
import type {
  SemanticRevisionJudgeInput,
  SemanticRevisionJudgeProvider,
  SemanticRevisionJudgmentDraft,
} from '@spec/protocol/semantic-revision-judge';

function installFakeChromeStorageLocal(): void {
  const data: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        },
      },
    },
  };
}

function fakeProvider(
  providerId: string,
  modelId: string,
  judgeFn: (input: SemanticRevisionJudgeInput) => Promise<SemanticRevisionJudgmentDraft>,
): { provider: SemanticRevisionJudgeProvider; judge: ReturnType<typeof vi.fn> } {
  const judge = vi.fn(judgeFn);
  const provider: SemanticRevisionJudgeProvider = { providerId, modelId, judge };
  return { provider, judge };
}

function setup() {
  installFakeChromeStorageLocal();
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const editEventStore = new EditEventStore(storage);
  const candidateStore = new SemanticDeltaCandidateStore(storage);
  const receiptStore = new SemanticDeltaExtractionReceiptStore(storage);
  const configStore = new SemanticRevisionJudgeConfigStore();
  return { storage, editEventStore, candidateStore, receiptStore, configStore };
}

function buildService(
  ctx: ReturnType<typeof setup>,
  judgeFn: (input: SemanticRevisionJudgeInput) => Promise<SemanticRevisionJudgmentDraft>,
  providerId = 'local-mlx/deterministic-semantic-judge-v3',
  modelId = 'Qwen/Qwen3-0.6B',
) {
  const { provider, judge } = fakeProvider(providerId, modelId, judgeFn);
  const createProvider = vi.fn(() => provider);
  const service = new SemanticRevisionJudgeExtractionService(
    ctx.storage,
    createProvider,
    ctx.editEventStore,
    ctx.candidateStore,
    ctx.receiptStore,
    ctx.configStore,
  );
  return { service, createProvider, judge };
}

const NO_CHANGE: SemanticRevisionJudgmentDraft = { verdict: 'no_meaningful_change', description: null, confidence: 0.9 };
const UNCERTAIN: SemanticRevisionJudgmentDraft = { verdict: 'uncertain', description: null, confidence: 0.3 };

describe('SemanticRevisionJudgeExtractionService', () => {
  it('throws when not enabled/configured', async () => {
    const ctx = setup();
    const { service } = buildService(ctx, async () => NO_CHANGE);
    await expect(service.runExperiment()).rejects.toThrow(/not enabled\/configured/);
  });

  it('does not invoke the provider when config is missing (no baseUrl)', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: false });
    const { service, createProvider } = buildService(ctx, async () => NO_CHANGE);
    await expect(service.runExperiment()).rejects.toThrow();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('calls the judge provider once per non-preserved intervention, not once per EditEvent', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('A X B Y C', 'A Z B W C'); // two replaced spans -> two interventions
    const { service, judge } = buildService(ctx, async () => NO_CHANGE);

    await service.runExperiment();
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('never sends a preserved-only span as a judgeable unit', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('A B C', 'A B C'); // fully preserved, zero interventions
    const { service, judge } = buildService(ctx, async () => NO_CHANGE);

    await service.runExperiment();
    expect(judge).not.toHaveBeenCalled();
  });

  it('no_meaningful_change is not persisted as a candidate', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('A X B', 'A Y B');
    const { service } = buildService(ctx, async () => NO_CHANGE);

    const { candidates, stats } = await service.runExperiment();
    expect(candidates).toEqual([]);
    expect(stats.noMeaningfulChange).toBe(1);
    await expect(ctx.candidateStore.list()).resolves.toEqual([]);
  });

  it('uncertain is not persisted as a candidate, and abstention is a successful outcome (no throw)', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    const event = await ctx.editEventStore.add('A X B', 'A Y B');
    const { service } = buildService(ctx, async () => UNCERTAIN);

    const { candidates, stats } = await service.runExperiment();
    expect(candidates).toEqual([]);
    expect(stats.uncertain).toBe(1);
    const receipt = await ctx.receiptStore.get(`edit_event:${event.id}`);
    expect(receipt?.outcome).toBe('abstained');
  });

  it('a valid meaning_transformed judgment on a replaced intervention becomes a persisted candidate with HDNA-generated provenance', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    const event = await ctx.editEventStore.add('A broad_framing B', 'A specific_framing B');
    const { service } = buildService(ctx, async () => ({
      verdict: 'meaning_transformed',
      description: 'Shifted from broad to specific framing.',
      confidence: 0.8,
    }));

    const { candidates } = await service.runExperiment();
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.sourceEvidenceId).toBe(`edit_event:${event.id}`);
    expect(candidate.extractorId).toBe('local-mlx/deterministic-semantic-judge-v3');
    expect(candidate.extractorVersion).toBe('Qwen/Qwen3-0.6B');
    expect(candidate.interventionId).toBe(`edit_event:${event.id}#0`);
    expect(candidate.kind).toBe('contrastive_preference');
    expect(candidate.preferred).toContain('specific_framing');
    expect(candidate.rejected).toContain('broad_framing');
    expect(candidate.id).toBeTruthy();
    expect(candidate.computedAt).toBeTruthy();
  });

  it('never stores raw sourceText/finalText inside a persisted candidate, and the config has no apiKey to leak in the first place', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('a very specific original span', 'a very specific final span');
    const { service } = buildService(ctx, async () => ({
      verdict: 'meaning_added',
      description: 'Added specificity.',
      confidence: 0.5,
    }));

    await service.runExperiment();
    const stored = await ctx.candidateStore.list();
    for (const candidate of stored) {
      expect(candidate).not.toHaveProperty('apiKey');
      expect(JSON.stringify(candidate)).not.toContain('a very specific original span');
      expect(JSON.stringify(candidate)).not.toContain('a very specific final span');
    }
  });

  it('is not duplicated: the same intervention does not produce two persisted candidates in one run', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('A X B', 'A Y B');
    const { service, judge } = buildService(ctx, async () => ({
      verdict: 'meaning_transformed',
      description: 'Changed X to Y.',
      confidence: 0.7,
    }));

    const { candidates } = await service.runExperiment();
    expect(judge).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(1);
  });

  describe('receipt-gated idempotency (per source, same discipline as Trial 0-2)', () => {
    it('does not re-invoke the judge for a source already processed by the same extractor/version', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
      await ctx.editEventStore.add('A X B', 'A Y B');

      const first = buildService(ctx, async () => NO_CHANGE);
      await first.service.runExperiment();
      expect(first.judge).toHaveBeenCalledTimes(1);

      const second = buildService(ctx, async () => NO_CHANGE);
      await second.service.runExperiment();
      expect(second.judge).not.toHaveBeenCalled();
    });

    it('DOES re-invoke the judge when the configured model changes (intentional re-run)', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'model-a' });
      await ctx.editEventStore.add('A X B', 'A Y B');

      const first = buildService(ctx, async () => NO_CHANGE, 'local-mlx/deterministic-semantic-judge-v3', 'model-a');
      await first.service.runExperiment();
      expect(first.judge).toHaveBeenCalledTimes(1);

      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'model-b' });
      const second = buildService(ctx, async () => NO_CHANGE, 'local-mlx/deterministic-semantic-judge-v3', 'model-b');
      await second.service.runExperiment();
      expect(second.judge).toHaveBeenCalledTimes(1);
    });

    it('a prior OpenRouter-transport Trial 3 receipt never suppresses a new local-MLX run (distinct extractorId)', async () => {
      const ctx = setup();
      const event = await ctx.editEventStore.add('A X B', 'A Y B');
      await ctx.receiptStore.put({
        sourceEvidenceId: `edit_event:${event.id}`,
        extractorId: 'openrouter/deterministic-semantic-judge-v3',
        extractorVersion: 'qwen/qwen3-1.7b',
        outcome: 'abstained',
        processedAt: '2026-01-01T00:00:00.000Z',
      });
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });

      const { service, judge } = buildService(ctx, async () => NO_CHANGE);
      await service.runExperiment();
      expect(judge).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure isolation', () => {
    it('a judge failure on one intervention does not abort the rest of the source or the run', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
      await ctx.editEventStore.add('A X B Y C', 'A Z B W C'); // two interventions

      let calls = 0;
      const { service } = buildService(ctx, async () => {
        calls += 1;
        if (calls === 1) throw new Error('Local MLX server unreachable at http://127.0.0.1:8080: fetch failed');
        return { verdict: 'meaning_transformed', description: 'Second change.', confidence: 0.6 };
      });

      const { candidates, stats } = await service.runExperiment();
      expect(stats.judgeFailures).toBe(1);
      expect(stats.judgeCalls).toBe(2);
      expect(candidates).toHaveLength(1);
    });

    it('surfaces the most recent judge failure message in stats.lastJudgeFailureMessage (e.g. local server unreachable)', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
      await ctx.editEventStore.add('A X B', 'A Y B');
      const { service } = buildService(ctx, async () => {
        throw new Error('Local MLX server unreachable at http://127.0.0.1:8080: fetch failed');
      });

      const { stats } = await service.runExperiment();
      expect(stats.lastJudgeFailureMessage).toMatch(/Local MLX server unreachable/);
    });

    it('a malformed judgment (fails validateJudgmentDraft) is an admission-stage rejection, not a persisted candidate', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
      await ctx.editEventStore.add('A X B', 'A Y B');
      const { service } = buildService(ctx, async () => ({
        verdict: 'meaning_added',
        description: null, // invalid: change-claiming verdict with null description
        confidence: 0.5,
      }));

      const { candidates } = await service.runExperiment();
      expect(candidates).toEqual([]);
    });

    it('a storage/persistence failure propagates out of runExperiment() rather than being silently swallowed', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
      await ctx.editEventStore.add('A X B', 'A Y B');
      vi.spyOn(ctx.storage, 'putMany').mockRejectedValueOnce(new Error('storage unavailable'));
      const { service } = buildService(ctx, async () => NO_CHANGE);

      await expect(service.runExperiment()).rejects.toThrow(/storage unavailable/);
    });
  });

  it('the candidates + receipt for a source are written atomically via storage.putMany', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('A X B', 'A Y B');
    const putManySpy = vi.spyOn(ctx.storage, 'putMany');
    const { service } = buildService(ctx, async () => ({
      verdict: 'meaning_transformed',
      description: 'Changed X to Y.',
      confidence: 0.7,
    }));

    await service.runExperiment();
    expect(putManySpy).toHaveBeenCalledTimes(1);
    const entries = putManySpy.mock.calls[0][0];
    expect(entries.some((e: { store: string }) => e.store === 'semantic_delta_candidates')).toBe(true);
    expect(entries.some((e: { store: string }) => e.store === 'semantic_delta_extraction_receipts')).toBe(true);
  });

  it('stats report interventionsTotal/judgeCalls/admitted counts usable for coverage evaluation', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    await ctx.editEventStore.add('A X B Y C', 'A Z B W C');
    const { service } = buildService(ctx, async () => ({
      verdict: 'meaning_transformed',
      description: 'A narrow change.',
      confidence: 0.6,
    }));

    const { stats } = await service.runExperiment();
    expect(stats.interventionsTotal).toBe(2);
    expect(stats.judgeCalls).toBe(2);
    expect(stats.admitted).toBe(2);
    expect(stats.sourcesProcessed).toBe(1);
  });
});
