import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { SemanticDeltaCandidateStore } from '../../src/persona/semantic-delta-candidate-store';
import { SemanticDeltaExtractionReceiptStore } from '../../src/persona/semantic-delta-extraction-receipt-store';
import { SemanticDeltaExtractorConfigStore } from '../../src/persona/semantic-delta-extractor-config-store';
import { SemanticDeltaExtractionService } from '../../src/persona/semantic-delta-extraction-service';
import {
  OpenRouterSemanticDeltaExtractor,
  EXTRACTION_PROMPT_VERSION,
} from '../../src/persona/openrouter-semantic-delta-extractor';
import {
  EXTRACT_SEMANTIC_DELTAS_JOB,
  createExtractSemanticDeltasProcessor,
  enqueueSemanticDeltaExtraction,
} from '../../src/queue/processors/semantic-delta-extraction-job';

// A single module-level fake standing in for the browser's real
// chrome.storage.local — genuinely shared state, not scoped to any
// particular SemanticDeltaExtractorConfigStore instance or execution
// context. Every SemanticDeltaExtractorConfigStore constructed after
// installFakeChromeStorageLocal() talks to the exact same backing object,
// the same way every real extension context talks to the exact same
// chrome.storage.local.
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

function fakeFetchReturningCandidates(candidates: unknown[]): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ candidates }) } }] }),
  })) as unknown as typeof fetch;
}

/**
 * Builds one "background service worker instance"'s worth of wiring —
 * fresh IndexedDbStorageAdapter (bound to dbName), fresh JobQueue, fresh
 * EditEventStore/SemanticDeltaCandidateStore/SemanticDeltaExtractionReceiptStore/
 * SemanticDeltaExtractorConfigStore, and the EXTRACT_SEMANTIC_DELTAS_JOB
 * processor registered — mirroring what entrypoints/background.ts
 * constructs on every service-worker startup. Calling this twice with the
 * same dbName (and the shared fake chrome.storage.local already installed)
 * simulates an MV3 service-worker restart: zero in-memory state carries
 * over between the two calls, only whatever was actually persisted.
 */
function buildBackgroundWiring(dbName: string, fetchImpl: typeof fetch) {
  const storage = new IndexedDbStorageAdapter(dbName);
  const queue = new JobQueue(storage);
  const editEventStore = new EditEventStore(storage);
  const candidateStore = new SemanticDeltaCandidateStore(storage);
  const receiptStore = new SemanticDeltaExtractionReceiptStore(storage);
  const configStore = new SemanticDeltaExtractorConfigStore();
  const createProvider = vi.fn(
    (apiKey: string, modelId: string) => new OpenRouterSemanticDeltaExtractor(apiKey, modelId, fetchImpl),
  );
  const service = new SemanticDeltaExtractionService(
    storage,
    createProvider,
    editEventStore,
    candidateStore,
    receiptStore,
    configStore,
  );
  queue.registerProcessor(EXTRACT_SEMANTIC_DELTAS_JOB, createExtractSemanticDeltasProcessor(service));
  return { storage, queue, editEventStore, candidateStore, receiptStore, configStore, createProvider };
}

describe('Phase 5A pipeline: popup save -> background reads persisted config -> EditEventStore lookup -> P3 process -> provider factory -> fetch', () => {
  beforeEach(() => {
    installFakeChromeStorageLocal();
  });

  it('a config saved from a "popup" instance is read by an independently-constructed "background" instance, all the way to fetch()', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;

    // "Popup": saves the config through its own store instance.
    const popupConfigStore = new SemanticDeltaExtractorConfigStore();
    await popupConfigStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    // "Background": a completely independent set of instances reads
    // whatever the popup wrote.
    const fetchImpl = fakeFetchReturningCandidates([]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.editEventStore.add('AI original draft', 'human final edit', { surface: 'chat' });

    await enqueueSemanticDeltaExtraction(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(background.createProvider).toHaveBeenCalledWith('sk-or-real', 'openai/gpt-4o-mini');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a real EditEvent's actual sourceText/finalText reach the provider (and ultimately the outbound fetch payload) unmodified", async () => {
    const dbName = `hdna-p5a-${Math.random()}`;
    const configStore = new SemanticDeltaExtractorConfigStore();
    await configStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    const fetchImpl = fakeFetchReturningCandidates([]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    const event = await background.editEventStore.add(
      'Maybe add several more features before launching so the product feels more complete.',
      'Önce bir MVP çıkart. Ana fikri kanıtlamadan özellik eklemenin mantığı yok.',
      { surface: 'product_development' },
    );

    await enqueueSemanticDeltaExtraction(background.queue);
    const job = await background.queue.runNext();
    expect(job?.status).toBe('COMPLETE');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(JSON.stringify(body)).toContain(event.sourceText);
    expect(JSON.stringify(body)).toContain(event.finalText);
  });

  it('provider is invoked exactly once for eligible unprocessed evidence', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;
    const configStore = new SemanticDeltaExtractorConfigStore();
    await configStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    const fetchImpl = fakeFetchReturningCandidates([
      { kind: 'behavioral_delta', observation: 'strengthens a recommendation', preferred: null, rejected: null, context: 'chat', confidence: 0.6 },
    ]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.editEventStore.add('AI original draft', 'human final edit', { surface: 'chat' });

    await enqueueSemanticDeltaExtraction(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(background.candidateStore.list()).resolves.toHaveLength(1);
    await expect(background.receiptStore.list()).resolves.toHaveLength(1);
  });

  it('provider is NOT invoked for already-processed evidence (a receipt for it already exists)', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;
    const configStore = new SemanticDeltaExtractorConfigStore();
    await configStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    const fetchImpl = fakeFetchReturningCandidates([
      { kind: 'behavioral_delta', observation: 'would extract if called', preferred: null, rejected: null, context: 'chat', confidence: 0.6 },
    ]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    const event = await background.editEventStore.add('already processed original', 'already processed final', {
      surface: 'chat',
    });
    // Seed a receipt matching the exact extractorId/extractorVersion the
    // background instance's provider will report, so the skip condition
    // in SemanticDeltaExtractionService applies.
    await background.receiptStore.put({
      sourceEvidenceId: `edit_event:${event.id}`,
      extractorId: `openrouter/${EXTRACTION_PROMPT_VERSION}`,
      extractorVersion: 'openai/gpt-4o-mini',
      outcome: 'abstained',
      processedAt: '2026-01-01T00:00:00.000Z',
    });

    await enqueueSemanticDeltaExtraction(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(background.candidateStore.list()).resolves.toEqual([]);
  });

  it('provider is NOT invoked at all when config is missing/disabled — distinguishing "correctly did nothing" from "silently succeeded"', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;
    // No config saved at all (chrome.storage.local defaults to { enabled: false }).
    const fetchImpl = fakeFetchReturningCandidates([]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.editEventStore.add('AI original draft', 'human final edit', { surface: 'chat' });

    await enqueueSemanticDeltaExtraction(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('FAILED');
    expect(job?.lastError).toMatch(/not enabled\/configured/);
    expect(background.createProvider).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(background.candidateStore.list()).resolves.toEqual([]);
    await expect(background.receiptStore.list()).resolves.toEqual([]);
  });

  it('the saved config and edit events survive a simulated service-worker restart between save and job processing', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;

    const popupConfigStore = new SemanticDeltaExtractorConfigStore();
    await popupConfigStore.set({ enabled: true, apiKey: 'sk-or-restart', modelId: 'openai/gpt-4o-mini' });

    // First "worker": writes an edit event and enqueues the job, then is
    // discarded entirely — nothing from it is reused below.
    const firstWorker = buildBackgroundWiring(dbName, fakeFetchReturningCandidates([]));
    await firstWorker.editEventStore.add('original', 'final', { surface: 'chat' });
    await enqueueSemanticDeltaExtraction(firstWorker.queue);

    // Second "worker": a brand-new set of instances (simulated restart)
    // processes the job. It must still see the config and edit event the
    // first worker/popup wrote to storage — no in-memory state is shared.
    const fetchImpl = fakeFetchReturningCandidates([]);
    const restarted = buildBackgroundWiring(dbName, fetchImpl);
    const job = await restarted.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(restarted.createProvider).toHaveBeenCalledWith('sk-or-restart', 'openai/gpt-4o-mini');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a synthetic cosmetic-edit fixture (spelling fix only) produces a zero-candidate abstained outcome end-to-end, not treated as an error', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;
    const configStore = new SemanticDeltaExtractorConfigStore();
    await configStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    // The fake provider (backed by a real OpenRouterSemanticDeltaExtractor
    // + fake fetch) abstains — an empty candidates array is a valid,
    // successful structured response, not a parse/schema error.
    const fetchImpl = fakeFetchReturningCandidates([]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    const event = await background.editEventStore.add(
      'The meetign is at 3pm.',
      'The meeting is at 3pm.',
      { surface: 'chat' },
    );

    await enqueueSemanticDeltaExtraction(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    await expect(background.candidateStore.list()).resolves.toEqual([]);
    const receipt = await background.receiptStore.get(`edit_event:${event.id}`);
    expect(receipt).toMatchObject({
      sourceEvidenceId: `edit_event:${event.id}`,
      outcome: 'abstained',
      extractorId: `openrouter/${EXTRACTION_PROMPT_VERSION}`,
      extractorVersion: 'openai/gpt-4o-mini',
    });
  });

  it('no test fixture API key ever appears in persisted candidates or receipts', async () => {
    const dbName = `hdna-p5a-${Math.random()}`;
    const secretApiKey = 'sk-or-INTEGRATION_SECRET_7e2f';
    const configStore = new SemanticDeltaExtractorConfigStore();
    await configStore.set({ enabled: true, apiKey: secretApiKey, modelId: 'openai/gpt-4o-mini' });

    const fetchImpl = fakeFetchReturningCandidates([
      { kind: 'behavioral_delta', observation: 'adds a concrete recommendation', preferred: null, rejected: null, context: 'chat', confidence: 0.6 },
    ]);
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.editEventStore.add('original', 'final', { surface: 'chat' });

    await enqueueSemanticDeltaExtraction(background.queue);
    await background.queue.runNext();

    const candidates = await background.candidateStore.list();
    const receipts = await background.receiptStore.list();
    expect(JSON.stringify(candidates)).not.toContain(secretApiKey);
    expect(JSON.stringify(receipts)).not.toContain(secretApiKey);
  });

  it('SemanticDeltaExtractorConfigStore survives independent "contexts" sharing only the fake chrome.storage.local', async () => {
    const popupInstance = new SemanticDeltaExtractorConfigStore();
    await popupInstance.set({ enabled: true, apiKey: 'sk-or-shared', modelId: 'openai/gpt-4o-mini' });

    const backgroundInstance = new SemanticDeltaExtractorConfigStore();
    await expect(backgroundInstance.get()).resolves.toEqual({
      enabled: true,
      apiKey: 'sk-or-shared',
      modelId: 'openai/gpt-4o-mini',
    });
  });
});
