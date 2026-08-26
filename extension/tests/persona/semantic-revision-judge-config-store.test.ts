import { beforeEach, describe, expect, it } from 'vitest';
import { SemanticRevisionJudgeConfigStore } from '../../src/persona/semantic-revision-judge-config-store';

// Deliberately no fake-indexeddb/IndexedDbStorageAdapter in this file —
// SemanticRevisionJudgeConfigStore bypasses StorageAdapter entirely and
// talks to chrome.storage.local directly, same reasoning as
// SemanticDeltaExtractorConfigStore/PersonaInterpreterConfigStore, but as
// a genuinely separate store/key (docs/decisions/0016's Trial 3 "local
// MLX transport" addendum).
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

describe('SemanticRevisionJudgeConfigStore', () => {
  beforeEach(() => {
    installFakeChromeStorageLocal();
  });

  it('defaults to disabled with no baseUrl/model id', async () => {
    const store = new SemanticRevisionJudgeConfigStore();
    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('round-trips a saved config through chrome.storage.local, not StorageAdapter', async () => {
    const store = new SemanticRevisionJudgeConfigStore();
    const config = { enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' };

    await store.set(config);
    await expect(store.get()).resolves.toEqual(config);
  });

  it('never has an apiKey field, structurally — a saved config round-trips without one', async () => {
    const store = new SemanticRevisionJudgeConfigStore();
    await store.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });
    const stored = await store.get();
    expect(stored).not.toHaveProperty('apiKey');
  });

  it('is independent from SemanticDeltaExtractorConfig — Trial 0-2 OpenRouter config never enables Trial 3', async () => {
    const store = new SemanticRevisionJudgeConfigStore();
    (
      globalThis as {
        chrome: { storage: { local: { set: (i: Record<string, unknown>) => Promise<void> } } };
      }
    ).chrome.storage.local.set({
      hdna_semantic_delta_extractor_config: { enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' },
    });

    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('survives independent store instances sharing the same underlying chrome.storage.local (simulated context/service-worker restart)', async () => {
    const popupInstance = new SemanticRevisionJudgeConfigStore();
    await popupInstance.set({ enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' });

    const backgroundInstance = new SemanticRevisionJudgeConfigStore();
    await expect(backgroundInstance.get()).resolves.toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:8080',
      modelId: 'Qwen/Qwen3-0.6B',
    });
  });
});
