import { beforeEach, describe, expect, it } from 'vitest';
import { Trial4BenchmarkConfigStore } from '../../src/persona/trial4-benchmark-config-store';

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

describe('Trial4BenchmarkConfigStore', () => {
  beforeEach(() => {
    installFakeChromeStorageLocal();
  });

  it('defaults to disabled with no model urls/ids', async () => {
    const store = new Trial4BenchmarkConfigStore();
    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('round-trips a saved config through chrome.storage.local, not StorageAdapter', async () => {
    const store = new Trial4BenchmarkConfigStore();
    const config = {
      enabled: true,
      baseModelUrl: 'http://127.0.0.1:8080',
      trainedModelUrl: 'http://127.0.0.1:8081',
      localModelId: 'Qwen/Qwen3-0.6B',
      deepSeekApiKey: 'sk-test',
      deepSeekModelId: 'deepseek-v4-flash',
    };

    await store.set(config);
    await expect(store.get()).resolves.toEqual(config);
  });

  it('never has baseModelUrl/trainedModelUrl/localModelId/deepSeekApiKey/deepSeekModelId fields when disabled', async () => {
    const store = new Trial4BenchmarkConfigStore();
    await store.set({
      enabled: true,
      baseModelUrl: 'http://127.0.0.1:8080',
      trainedModelUrl: 'http://127.0.0.1:8081',
      localModelId: 'Qwen/Qwen3-0.6B',
      deepSeekApiKey: 'sk-test',
      deepSeekModelId: 'deepseek-v4-flash',
    });
    await store.set({ enabled: false });
    const stored = await store.get();
    expect(stored.enabled).toBe(false);
    expect(stored).not.toHaveProperty('baseModelUrl');
    expect(stored).not.toHaveProperty('trainedModelUrl');
    expect(stored).not.toHaveProperty('localModelId');
    expect(stored).not.toHaveProperty('deepSeekApiKey');
    expect(stored).not.toHaveProperty('deepSeekModelId');
  });

  it('survives independent store instances sharing the same underlying chrome.storage.local', async () => {
    const popupInstance = new Trial4BenchmarkConfigStore();
    await popupInstance.set({
      enabled: true,
      baseModelUrl: 'http://127.0.0.1:8080',
      trainedModelUrl: 'http://127.0.0.1:8081',
      localModelId: 'Qwen/Qwen3-0.6B',
      deepSeekApiKey: 'sk-test',
      deepSeekModelId: 'deepseek-v4-flash',
    });

    const backgroundInstance = new Trial4BenchmarkConfigStore();
    await expect(backgroundInstance.get()).resolves.toEqual({
      enabled: true,
      baseModelUrl: 'http://127.0.0.1:8080',
      trainedModelUrl: 'http://127.0.0.1:8081',
      localModelId: 'Qwen/Qwen3-0.6B',
      deepSeekApiKey: 'sk-test',
      deepSeekModelId: 'deepseek-v4-flash',
    });
  });

  it('is independent from SemanticRevisionJudgeConfig — Trial 3 single-endpoint config never enables Trial 4', async () => {
    const store = new Trial4BenchmarkConfigStore();
    (
      globalThis as {
        chrome: { storage: { local: { set: (i: Record<string, unknown>) => Promise<void> } } };
      }
    ).chrome.storage.local.set({
      hdna_semantic_revision_judge_config: { enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'Qwen/Qwen3-0.6B' },
    });

    await expect(store.get()).resolves.toEqual({ enabled: false });
  });

  it('stores deepSeekApiKey only in Trial 4 config, never conflated with OpenRouter api key', async () => {
    const store = new Trial4BenchmarkConfigStore();
    await store.set({
      enabled: true,
      baseModelUrl: 'http://127.0.0.1:8080',
      trainedModelUrl: 'http://127.0.0.1:8081',
      localModelId: 'Qwen/Qwen3-0.6B',
      deepSeekApiKey: 'sk-deepseek-secret',
      deepSeekModelId: 'deepseek-v4-flash',
    });

    const stored = await store.get();
    expect(stored.deepSeekApiKey).toBe('sk-deepseek-secret');
    expect(JSON.stringify(stored)).not.toMatch(/openrouter/i);
  });
});
