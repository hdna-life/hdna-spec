import { beforeEach, describe, expect, it } from 'vitest';
import { SemanticDeltaExtractorConfigStore } from '../../src/persona/semantic-delta-extractor-config-store';

// Deliberately no fake-indexeddb/IndexedDbStorageAdapter in this file —
// SemanticDeltaExtractorConfigStore bypasses StorageAdapter entirely and
// talks to chrome.storage.local directly, same reasoning as
// PersonaInterpreterConfigStore (docs/decisions/0015), but as a genuinely
// separate store/key (docs/decisions/0016).
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

describe('SemanticDeltaExtractorConfigStore', () => {
  beforeEach(() => {
    installFakeChromeStorageLocal();
  });

  it('defaults to disabled with no api key/model id', async () => {
    const store = new SemanticDeltaExtractorConfigStore();
    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('round-trips a saved config through chrome.storage.local, not StorageAdapter', async () => {
    const store = new SemanticDeltaExtractorConfigStore();
    const config = { enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' };

    await store.set(config);
    await expect(store.get()).resolves.toEqual(config);
  });

  it('is independent from PersonaInterpreterConfig — enabling T3 does not enable this experiment', async () => {
    const store = new SemanticDeltaExtractorConfigStore();
    // Simulate T3's config already being saved under its own separate key.
    (globalThis as { chrome: { storage: { local: { set: (i: Record<string, unknown>) => Promise<void> } } } }).chrome.storage.local.set(
      { hdna_persona_interpreter_config: { enabled: true, apiKey: 'sk-or-t3', modelId: 'openai/gpt-4o-mini' } },
    );

    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('survives independent store instances sharing the same underlying chrome.storage.local (simulated context/service-worker restart)', async () => {
    const popupInstance = new SemanticDeltaExtractorConfigStore();
    await popupInstance.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' });

    const backgroundInstance = new SemanticDeltaExtractorConfigStore();
    await expect(backgroundInstance.get()).resolves.toEqual({
      enabled: true,
      apiKey: 'sk-or-test',
      modelId: 'openai/gpt-4o-mini',
    });
  });
});
