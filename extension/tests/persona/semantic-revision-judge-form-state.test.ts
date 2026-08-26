import { describe, expect, it } from 'vitest';
import {
  computeFormHydration,
  deriveJudgeReadiness,
  resolveSavedConfig,
} from '../../src/persona/semantic-revision-judge-form-state';
import type { SemanticRevisionJudgeConfig } from '../../src/persona/semantic-revision-judge-config-store';

describe('computeFormHydration (Trial 3 local MLX form)', () => {
  it('hydrates fields from the initial placeholder default config', () => {
    const placeholderDefault: SemanticRevisionJudgeConfig = { enabled: false };
    expect(computeFormHydration(false, placeholderDefault)).toEqual({
      baseUrlInput: '',
      modelIdInput: '',
      enabledInput: false,
    });
  });

  it('re-hydrates once the real persisted config arrives a tick later — no one-shot latch', () => {
    const placeholderDefault: SemanticRevisionJudgeConfig = { enabled: false };
    const persistedConfig: SemanticRevisionJudgeConfig = {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8080',
      modelId: 'Qwen/Qwen3-0.6B',
    };

    computeFormHydration(false, placeholderDefault);
    const secondResult = computeFormHydration(false, persistedConfig);

    expect(secondResult).toEqual({
      baseUrlInput: 'http://127.0.0.1:8080',
      modelIdInput: 'Qwen/Qwen3-0.6B',
      enabledInput: true,
    });
  });

  it('unlike the OpenRouter form, baseUrl is not a secret — it hydrates directly, not blanked', () => {
    const config: SemanticRevisionJudgeConfig = { enabled: true, baseUrl: 'http://127.0.0.1:8080' };
    expect(computeFormHydration(false, config)?.baseUrlInput).toBe('http://127.0.0.1:8080');
  });

  it('returns null while dirty, so the parent refresh poll can never clobber an in-progress edit', () => {
    const config: SemanticRevisionJudgeConfig = { enabled: true, baseUrl: 'http://127.0.0.1:8080', modelId: 'm' };
    expect(computeFormHydration(true, config)).toBeNull();
  });
});

describe('resolveSavedConfig (Trial 3 local MLX form)', () => {
  it('persists the entered baseUrl/modelId/enabled fields', () => {
    const fields = { baseUrlInput: 'http://127.0.0.1:8080', modelIdInput: 'Qwen/Qwen3-0.6B', enabledInput: true };
    expect(resolveSavedConfig(fields)).toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:8080',
      modelId: 'Qwen/Qwen3-0.6B',
    });
  });

  it('treats a whitespace-only baseUrl the same as blank (undefined)', () => {
    const fields = { baseUrlInput: '   ', modelIdInput: 'Qwen/Qwen3-0.6B', enabledInput: false };
    expect(resolveSavedConfig(fields).baseUrl).toBeUndefined();
  });

  it('persists a blank model id as undefined, not an empty string', () => {
    const fields = { baseUrlInput: 'http://127.0.0.1:8080', modelIdInput: '  ', enabledInput: false };
    expect(resolveSavedConfig(fields).modelId).toBeUndefined();
  });

  it('never produces an apiKey field on the resolved config', () => {
    const fields = { baseUrlInput: 'http://127.0.0.1:8080', modelIdInput: 'Qwen/Qwen3-0.6B', enabledInput: true };
    expect(resolveSavedConfig(fields)).not.toHaveProperty('apiKey');
  });
});

describe('deriveJudgeReadiness', () => {
  it('is not-configured when disabled, naming exactly "enabled" as missing', () => {
    const config: SemanticRevisionJudgeConfig = { enabled: false, baseUrl: 'http://127.0.0.1:8080', modelId: 'm' };
    expect(deriveJudgeReadiness(config)).toEqual({ kind: 'not-configured', missing: ['enabled'] });
  });

  it('is not-configured when enabled but missing baseUrl', () => {
    const config: SemanticRevisionJudgeConfig = { enabled: true, modelId: 'm' };
    expect(deriveJudgeReadiness(config)).toEqual({ kind: 'not-configured', missing: ['baseUrl'] });
  });

  it('is not-configured when enabled with a baseUrl but missing a model id', () => {
    const config: SemanticRevisionJudgeConfig = { enabled: true, baseUrl: 'http://127.0.0.1:8080' };
    expect(deriveJudgeReadiness(config)).toEqual({ kind: 'not-configured', missing: ['modelId'] });
  });

  it('names every missing field when more than one is missing', () => {
    const config: SemanticRevisionJudgeConfig = { enabled: false };
    expect(deriveJudgeReadiness(config)).toEqual({
      kind: 'not-configured',
      missing: ['enabled', 'baseUrl', 'modelId'],
    });
  });

  it('is ready when fully configured', () => {
    const config: SemanticRevisionJudgeConfig = {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8080',
      modelId: 'Qwen/Qwen3-0.6B',
    };
    expect(deriveJudgeReadiness(config)).toEqual({ kind: 'ready' });
  });
});
