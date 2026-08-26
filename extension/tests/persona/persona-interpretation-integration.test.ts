import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { PatternStore } from '../../src/persona/pattern-store';
import { TraitBeliefStore } from '../../src/persona/trait-belief-store';
import { PersonaInterpreterConfigStore } from '../../src/persona/persona-interpreter-config-store';
import { PersonaInterpreterService } from '../../src/persona/persona-interpreter-service';
import { OpenRouterPersonaInterpreter } from '../../src/persona/openrouter-persona-interpreter';
import {
  INTERPRET_TRAITS_BELIEFS_JOB,
  createInterpretTraitsBeliefsProcessor,
  enqueuePersonaInterpretation,
} from '../../src/queue/processors/persona-interpretation-job';
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

// A single module-level fake standing in for the browser's real
// chrome.storage.local — genuinely shared state, not scoped to any
// particular PersonaInterpreterConfigStore instance or execution context.
// This is what makes the tests below actually prove "the popup and the
// background service worker read/write the same storage": every
// PersonaInterpreterConfigStore constructed after installFakeChromeStorageLocal()
// talks to the exact same backing object, the same way every real
// extension context talks to the exact same chrome.storage.local.
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

function fakeFetchReturningNoClaims(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ claims: [] }) } }] }),
  })) as unknown as typeof fetch;
}

/**
 * Builds one "background service worker instance"'s worth of wiring —
 * fresh IndexedDbStorageAdapter (bound to dbName), fresh JobQueue, fresh
 * PatternStore/TraitBeliefStore/PersonaInterpreterConfigStore, and the
 * INTERPRET_TRAITS_BELIEFS_JOB processor registered — mirroring exactly
 * what entrypoints/background.ts constructs on every service-worker
 * startup. Calling this twice with the same dbName (and the shared fake
 * chrome.storage.local already installed) simulates an MV3 service-worker
 * restart: zero in-memory state carries over between the two calls, only
 * whatever was actually persisted.
 */
function buildBackgroundWiring(dbName: string, fetchImpl: typeof fetch) {
  const storage = new IndexedDbStorageAdapter(dbName);
  const queue = new JobQueue(storage);
  const patternStore = new PatternStore(storage);
  const traitBeliefStore = new TraitBeliefStore(storage);
  const configStore = new PersonaInterpreterConfigStore();
  const createProvider = vi.fn(
    (apiKey: string, modelId: string) => new OpenRouterPersonaInterpreter(apiKey, modelId, fetchImpl),
  );
  const service = new PersonaInterpreterService(createProvider, patternStore, traitBeliefStore, configStore);
  queue.registerProcessor(INTERPRET_TRAITS_BELIEFS_JOB, createInterpretTraitsBeliefsProcessor(service));
  return { queue, patternStore, traitBeliefStore, configStore, createProvider };
}

describe('T3 pipeline: popup save -> background reads persisted config -> enqueue -> P3 process -> provider factory -> fetch', () => {
  beforeEach(() => {
    installFakeChromeStorageLocal();
  });

  it('a config saved from a "popup" instance is read by an independently-constructed "background" instance, all the way to fetch()', async () => {
    const dbName = `hdna-t3-${Math.random()}`;

    // "Popup": saves the config through its own store instance.
    const popupConfigStore = new PersonaInterpreterConfigStore();
    await popupConfigStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    // "Background": a completely independent set of instances (its own
    // JobQueue, PatternStore, PersonaInterpreterConfigStore) reads whatever
    // the popup wrote, with enough patterns to clear the eligibility gate.
    const fetchImpl = fakeFetchReturningNoClaims();
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.patternStore.put(pattern({ dimension: 'formality' }));
    await background.patternStore.put(pattern({ dimension: 'directness' }));

    await enqueuePersonaInterpretation(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(background.createProvider).toHaveBeenCalledWith('sk-or-real', 'openai/gpt-4o-mini');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('the saved config and patterns survive a simulated service-worker restart between save and job processing', async () => {
    const dbName = `hdna-t3-${Math.random()}`;

    const popupConfigStore = new PersonaInterpreterConfigStore();
    await popupConfigStore.set({ enabled: true, apiKey: 'sk-or-restart', modelId: 'openai/gpt-4o-mini' });

    // First "worker": writes patterns and enqueues the job, then is
    // discarded entirely — nothing from it is reused below.
    const firstWorker = buildBackgroundWiring(dbName, fakeFetchReturningNoClaims());
    await firstWorker.patternStore.put(pattern({ dimension: 'formality' }));
    await firstWorker.patternStore.put(pattern({ dimension: 'directness' }));
    await enqueuePersonaInterpretation(firstWorker.queue);

    // Second "worker": a brand-new set of instances (simulated restart)
    // processes the job. It must still see the config and patterns the
    // first worker/popup wrote to storage — no in-memory state is shared.
    const fetchImpl = fakeFetchReturningNoClaims();
    const restarted = buildBackgroundWiring(dbName, fetchImpl);
    const job = await restarted.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(restarted.createProvider).toHaveBeenCalledWith('sk-or-restart', 'openai/gpt-4o-mini');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never reaches fetch() when not configured — the job fails observably rather than looking like a successful no-op', async () => {
    const dbName = `hdna-t3-${Math.random()}`;
    // No config saved at all (chrome.storage.local defaults to { enabled: false }).
    const fetchImpl = fakeFetchReturningNoClaims();
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.patternStore.put(pattern({ dimension: 'formality' }));
    await background.patternStore.put(pattern({ dimension: 'directness' }));

    await enqueuePersonaInterpretation(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('FAILED');
    expect(job?.lastError).toMatch(/not enabled\/configured/);
    expect(background.createProvider).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never reaches fetch() when below the pattern threshold, distinguishing "correctly did nothing" from "silently succeeded"', async () => {
    const dbName = `hdna-t3-${Math.random()}`;
    const popupConfigStore = new PersonaInterpreterConfigStore();
    await popupConfigStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    const fetchImpl = fakeFetchReturningNoClaims();
    const background = buildBackgroundWiring(dbName, fetchImpl);
    // Only 1 distinct pattern — below the default minPatternCount of 2.
    await background.patternStore.put(pattern({ dimension: 'formality' }));

    await enqueuePersonaInterpretation(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(background.createProvider).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reaches fetch() exactly once for the operator\'s exact real persisted corpus (compressionRatio/unscoped + lexicalOverlap/unscoped)', async () => {
    // Regression fixture: docs/validation/manual-mvp-validation.md's Phase 4
    // observed exactly these two compiled Patterns from the operator's real
    // corpus. This proves the deterministic eligibility path is not the
    // reason a manual retest saw zero OpenRouter requests — the exact same
    // two Pattern records, read from PatternStore the same way the real
    // background service worker reads them, do reach an actual fetch()
    // call end to end: PatternStore -> isEligibleForInterpretation (true)
    // -> P3 processor -> PersonaInterpreterService -> provider factory ->
    // fetch, exactly once.
    const dbName = `hdna-t3-${Math.random()}`;
    const popupConfigStore = new PersonaInterpreterConfigStore();
    await popupConfigStore.set({ enabled: true, apiKey: 'sk-or-real', modelId: 'openai/gpt-4o-mini' });

    const fetchImpl = fakeFetchReturningNoClaims();
    const background = buildBackgroundWiring(dbName, fetchImpl);
    await background.patternStore.put(
      pattern({ dimension: 'compressionRatio', context: 'unscoped', value: 0.84, sampleCount: 5 }),
    );
    await background.patternStore.put(
      pattern({ dimension: 'lexicalOverlap', context: 'unscoped', value: 0.09, sampleCount: 5 }),
    );

    // Sanity check: this is exactly the corpus PatternStore.list() would
    // return to any reader — popup or background — since both talk to the
    // same underlying storage; nothing about this fixture depends on which
    // context reads it.
    await expect(background.patternStore.list()).resolves.toHaveLength(2);

    await enqueuePersonaInterpretation(background.queue);
    const job = await background.queue.runNext();

    expect(job?.status).toBe('COMPLETE');
    expect(background.createProvider).toHaveBeenCalledTimes(1);
    expect(background.createProvider).toHaveBeenCalledWith('sk-or-real', 'openai/gpt-4o-mini');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
