import { beforeEach, describe, expect, it } from 'vitest';
import { PersonaInterpreterConfigStore } from '../../src/persona/persona-interpreter-config-store';

// Deliberately no fake-indexeddb/IndexedDbStorageAdapter anywhere in this
// file — PersonaInterpreterConfigStore bypasses StorageAdapter entirely and
// talks to chrome.storage.local directly (see docs/decisions/0015), so this
// minimal in-memory fake is the only dependency this test needs.
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

describe('PersonaInterpreterConfigStore', () => {
  beforeEach(() => {
    installFakeChromeStorageLocal();
  });

  it('defaults to disabled with no api key/model id', async () => {
    const store = new PersonaInterpreterConfigStore();
    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('round-trips a saved config through chrome.storage.local, not StorageAdapter', async () => {
    const store = new PersonaInterpreterConfigStore();
    const config = { enabled: true, apiKey: 'sk-or-test', modelId: 'openai/gpt-4o-mini' };

    await store.set(config);
    await expect(store.get()).resolves.toEqual(config);
  });
});
