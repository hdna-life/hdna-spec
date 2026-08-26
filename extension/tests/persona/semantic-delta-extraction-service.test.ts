import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { SemanticDeltaCandidateStore } from '../../src/persona/semantic-delta-candidate-store';
import { SemanticDeltaExtractionReceiptStore } from '../../src/persona/semantic-delta-extraction-receipt-store';
import { SemanticDeltaExtractorConfigStore } from '../../src/persona/semantic-delta-extractor-config-store';
import { SemanticDeltaExtractionService } from '../../src/persona/semantic-delta-extraction-service';
import type {
  SemanticDeltaCandidateDraft,
  SemanticDeltaExtractorProvider,
} from '@spec/protocol/semantic-delta-extractor';

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
  drafts: SemanticDeltaCandidateDraft[],
): { provider: SemanticDeltaExtractorProvider; extract: ReturnType<typeof vi.fn> } {
  const extract = vi.fn(async () => drafts);
  const provider: SemanticDeltaExtractorProvider = { providerId, modelId, extract };
  return { provider, extract };
}

function setup() {
  installFakeChromeStorageLocal();
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const editEventStore = new EditEventStore(storage);
  const candidateStore = new SemanticDeltaCandidateStore(storage);
  const receiptStore = new SemanticDeltaExtractionReceiptStore(storage);
  const configStore = new SemanticDeltaExtractorConfigStore();
  return { storage, editEventStore, candidateStore, receiptStore, configStore };
}

function buildService(
  ctx: ReturnType<typeof setup>,
  drafts: SemanticDeltaCandidateDraft[],
  providerId = 'openrouter',
  modelId = 'openai/gpt-4o-mini',
) {
  const { provider, extract } = fakeProvider(providerId, modelId, drafts);
  const createProvider = vi.fn(() => provider);
  const service = new SemanticDeltaExtractionService(
    ctx.storage,
    createProvider,
    ctx.editEventStore,
    ctx.candidateStore,
    ctx.receiptStore,
    ctx.configStore,
  );
  return { service, createProvider, extract };
}

describe('SemanticDeltaExtractionService', () => {
  it('throws when not enabled/configured', async () => {
    const ctx = setup();
    const { service } = buildService(ctx, []);
    await expect(service.runExperiment()).rejects.toThrow(/not enabled\/configured/);
  });

  it('does not invoke the provider when config is missing enabled/apiKey/modelId', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: false });
    const { service, createProvider } = buildService(ctx, []);
    await expect(service.runExperiment()).rejects.toThrow();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('invokes the provider exactly once for a single eligible unprocessed edit event', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    const event = await ctx.editEventStore.add('AI original draft', 'human final edit', { surface: 'chat' });
    const { service, extract } = buildService(ctx, [
      { kind: 'behavioral_delta', observation: 'adds explicit recommendation', context: 'chat', confidence: 0.6 },
    ]);

    const candidates = await service.runExperiment();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith({
      originalText: event.sourceText,
      finalText: event.finalText,
      context: 'chat',
    });
    expect(candidates).toHaveLength(1);
  });

  it('defaults context to "unscoped" when the edit event has none', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    await ctx.editEventStore.add('original', 'final');
    const { service, extract } = buildService(ctx, []);

    await service.runExperiment();
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ context: 'unscoped' }));
  });

  it('produces a candidate with correct provenance: sourceEvidenceId, extractorId, extractorVersion', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    const event = await ctx.editEventStore.add('original', 'final');
    const { service } = buildService(ctx, [
      { kind: 'behavioral_delta', observation: 'observed delta', context: 'unscoped', confidence: 0.5 },
    ]);

    const [candidate] = await service.runExperiment();
    expect(candidate.sourceEvidenceId).toBe(`edit_event:${event.id}`);
    expect(candidate.extractorId).toBe('openrouter');
    expect(candidate.extractorVersion).toBe('openai/gpt-4o-mini');
  });

  it('never stores raw sourceText/finalText inside the persisted candidate', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    await ctx.editEventStore.add('a very specific original draft text', 'a very specific final edited text');
    const { service } = buildService(ctx, [
      { kind: 'behavioral_delta', observation: 'observed delta', context: 'unscoped', confidence: 0.5 },
    ]);

    await service.runExperiment();
    const [stored] = await ctx.candidateStore.list();
    expect(stored).not.toHaveProperty('sourceText');
    expect(stored).not.toHaveProperty('finalText');
    expect(stored).not.toHaveProperty('apiKey');
    expect(JSON.stringify(stored)).not.toContain('a very specific original draft text');
    expect(JSON.stringify(stored)).not.toContain('a very specific final edited text');
  });

  it('drops invalid drafts via validateCandidateDraft (e.g. contrastive_preference missing rejected)', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    await ctx.editEventStore.add('original', 'final');
    const { service } = buildService(ctx, [
      { kind: 'contrastive_preference', observation: 'x', preferred: 'a', context: 'unscoped', confidence: 0.5 },
    ]);

    const candidates = await service.runExperiment();
    expect(candidates).toEqual([]);
    const receipts = await ctx.receiptStore.list();
    expect(receipts[0].outcome).toBe('abstained');
  });

  it('accepts an observation-centered behavioral_delta candidate with no fabricated preferred/rejected', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    await ctx.editEventStore.add('original', 'final');
    const { service } = buildService(ctx, [
      { kind: 'behavioral_delta', observation: 'strengthened a position', context: 'unscoped', confidence: 0.8 },
    ]);

    const [candidate] = await service.runExperiment();
    expect(candidate.preferred).toBeUndefined();
    expect(candidate.rejected).toBeUndefined();
    expect(candidate.observation).toBe('strengthened a position');
  });

  describe('abstention', () => {
    it('writes an "abstained" receipt and zero candidates when the provider returns an empty array', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
      const event = await ctx.editEventStore.add('Fix typo: "teh" -> "the"', 'Fix typo: "the"');
      const { service } = buildService(ctx, []);

      const candidates = await service.runExperiment();
      expect(candidates).toEqual([]);
      await expect(ctx.candidateStore.list()).resolves.toEqual([]);

      const receipt = await ctx.receiptStore.get(`edit_event:${event.id}`);
      expect(receipt).toMatchObject({
        sourceEvidenceId: `edit_event:${event.id}`,
        extractorId: 'openrouter',
        extractorVersion: 'openai/gpt-4o-mini',
        outcome: 'abstained',
      });
    });

    it('a cosmetic/grammar-only edit fixture can produce/accept zero candidates without error', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
      await ctx.editEventStore.add(
        'The quick brown fox jump over the lazy dog.',
        'The quick brown fox jumps over the lazy dog.',
      );
      const { service } = buildService(ctx, []);

      await expect(service.runExperiment()).resolves.toEqual([]);
    });
  });

  describe('receipt-gated idempotency', () => {
    it('writes an "extracted" receipt when candidates are produced', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
      const event = await ctx.editEventStore.add('original', 'final');
      const { service } = buildService(ctx, [
        { kind: 'behavioral_delta', observation: 'x', context: 'unscoped', confidence: 0.5 },
      ]);

      await service.runExperiment();
      const receipt = await ctx.receiptStore.get(`edit_event:${event.id}`);
      expect(receipt?.outcome).toBe('extracted');
    });

    it('does not re-invoke the provider for a source already processed by the same extractor/version', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
      await ctx.editEventStore.add('original', 'final');

      const first = buildService(ctx, []);
      await first.service.runExperiment();
      expect(first.extract).toHaveBeenCalledTimes(1);

      const second = buildService(ctx, []);
      await second.service.runExperiment();
      expect(second.extract).not.toHaveBeenCalled();
    });

    it('does not re-invoke the provider for a source that previously abstained (zero candidates is still "processed")', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
      await ctx.editEventStore.add('original', 'final');

      const first = buildService(ctx, []); // abstains
      await first.service.runExperiment();

      const second = buildService(ctx, [
        { kind: 'behavioral_delta', observation: 'would extract if called', context: 'unscoped', confidence: 0.9 },
      ]);
      await second.service.runExperiment();
      expect(second.extract).not.toHaveBeenCalled();
    });

    it('DOES re-invoke the provider when the configured extractor version changes (intentional re-extraction)', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'model-a' });
      await ctx.editEventStore.add('original', 'final');

      const first = buildService(ctx, [], 'openrouter', 'model-a');
      await first.service.runExperiment();
      expect(first.extract).toHaveBeenCalledTimes(1);

      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'model-b' });
      const second = buildService(ctx, [], 'openrouter', 'model-b');
      await second.service.runExperiment();
      expect(second.extract).toHaveBeenCalledTimes(1);
    });

    it('provider is invoked only for the unprocessed source, not the already-processed one, in a mixed batch', async () => {
      const ctx = setup();
      await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
      const processed = await ctx.editEventStore.add('processed original', 'processed final');
      await ctx.receiptStore.put({
        sourceEvidenceId: `edit_event:${processed.id}`,
        extractorId: 'openrouter',
        extractorVersion: 'openai/gpt-4o-mini',
        outcome: 'abstained',
        processedAt: '2026-01-01T00:00:00.000Z',
      });
      await ctx.editEventStore.add('new original', 'new final');

      const { service, extract } = buildService(ctx, [
        { kind: 'behavioral_delta', observation: 'x', context: 'unscoped', confidence: 0.5 },
      ]);

      await service.runExperiment();
      expect(extract).toHaveBeenCalledTimes(1);
      expect(extract).toHaveBeenCalledWith(expect.objectContaining({ originalText: 'new original' }));
    });
  });

  it('the candidate + receipt for an extraction are written atomically via storage.putMany', async () => {
    const ctx = setup();
    await ctx.configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });
    const event = await ctx.editEventStore.add('original', 'final');
    const putManySpy = vi.spyOn(ctx.storage, 'putMany');
    const { service } = buildService(ctx, [
      { kind: 'behavioral_delta', observation: 'x', context: 'unscoped', confidence: 0.5 },
    ]);

    await service.runExperiment();
    expect(putManySpy).toHaveBeenCalledTimes(1);
    const entries = putManySpy.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries.some((e: { store: string }) => e.store === 'semantic_delta_candidates')).toBe(true);
    expect(entries.some((e: { store: string }) => e.store === 'semantic_delta_extraction_receipts')).toBe(true);
    void event;
  });
});
