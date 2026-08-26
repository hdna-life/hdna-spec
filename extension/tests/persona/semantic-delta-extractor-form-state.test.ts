import { describe, expect, it } from 'vitest';
import {
  computeFormHydration,
  deriveExtractionReadiness,
  resolveSavedConfig,
} from '../../src/persona/semantic-delta-extractor-form-state';
import type { SemanticDeltaExtractorConfig } from '../../src/persona/semantic-delta-extractor-config-store';

describe('computeFormHydration', () => {
  it('hydrates fields from the initial placeholder default config', () => {
    const placeholderDefault: SemanticDeltaExtractorConfig = { enabled: false };
    expect(computeFormHydration(false, placeholderDefault)).toEqual({
      apiKeyInput: '',
      modelIdInput: '',
      enabledInput: false,
    });
  });

  it('re-hydrates once the real persisted config arrives a tick later — no one-shot latch', () => {
    const placeholderDefault: SemanticDeltaExtractorConfig = { enabled: false };
    const persistedConfig: SemanticDeltaExtractorConfig = {
      enabled: true,
      apiKey: 'sk-or-secret',
      modelId: 'openai/gpt-4o-mini',
    };

    computeFormHydration(false, placeholderDefault);
    const secondResult = computeFormHydration(false, persistedConfig);

    expect(secondResult).toEqual({
      apiKeyInput: '',
      modelIdInput: 'openai/gpt-4o-mini',
      enabledInput: true,
    });
  });

  it('never re-inserts the saved API key into the input', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk-or-secret' };
    expect(computeFormHydration(false, config)?.apiKeyInput).toBe('');
  });

  it('returns null while dirty, so the parent refresh poll can never clobber an in-progress edit', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk-or-secret', modelId: 'm' };
    expect(computeFormHydration(true, config)).toBeNull();
  });

  it('ignores a changed config entirely while dirty, even across a legitimate save round-trip', () => {
    const beforeSave: SemanticDeltaExtractorConfig = { enabled: false };
    const afterSave: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk-or-new', modelId: 'm1' };
    expect(computeFormHydration(true, beforeSave)).toBeNull();
    expect(computeFormHydration(true, afterSave)).toBeNull();
  });
});

describe('resolveSavedConfig', () => {
  it('uses the newly-typed API key when the field is non-empty', () => {
    const fields = { apiKeyInput: 'sk-or-new', modelIdInput: 'm1', enabledInput: true };
    const currentConfig: SemanticDeltaExtractorConfig = { enabled: false, apiKey: 'sk-or-old' };
    expect(resolveSavedConfig(fields, currentConfig)).toEqual({ enabled: true, modelId: 'm1', apiKey: 'sk-or-new' });
  });

  it('preserves the existing saved key when the field is left blank', () => {
    const fields = { apiKeyInput: '', modelIdInput: 'm2', enabledInput: false };
    const currentConfig: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk-or-old' };
    expect(resolveSavedConfig(fields, currentConfig)).toEqual({ enabled: false, modelId: 'm2', apiKey: 'sk-or-old' });
  });

  it('treats a whitespace-only field the same as blank', () => {
    const fields = { apiKeyInput: '   ', modelIdInput: 'm2', enabledInput: false };
    const currentConfig: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk-or-old' };
    expect(resolveSavedConfig(fields, currentConfig).apiKey).toBe('sk-or-old');
  });

  it('leaves apiKey undefined when the field is blank and nothing was ever saved', () => {
    const fields = { apiKeyInput: '', modelIdInput: 'm3', enabledInput: false };
    const currentConfig: SemanticDeltaExtractorConfig = { enabled: false };
    expect(resolveSavedConfig(fields, currentConfig)).toEqual({ enabled: false, modelId: 'm3', apiKey: undefined });
  });

  it('persists a blank model id as undefined, not an empty string', () => {
    const fields = { apiKeyInput: '', modelIdInput: '  ', enabledInput: false };
    const currentConfig: SemanticDeltaExtractorConfig = { enabled: false, modelId: 'old-model' };
    expect(resolveSavedConfig(fields, currentConfig).modelId).toBeUndefined();
  });
});

describe('deriveExtractionReadiness', () => {
  it('is not-configured when disabled, naming exactly "enabled" as missing', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: false, apiKey: 'sk', modelId: 'm' };
    expect(deriveExtractionReadiness(config)).toEqual({ kind: 'not-configured', missing: ['enabled'] });
  });

  it('is not-configured when enabled but missing an api key', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: true, modelId: 'm' };
    expect(deriveExtractionReadiness(config)).toEqual({ kind: 'not-configured', missing: ['apiKey'] });
  });

  it('is not-configured when enabled with a key but missing a model id', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk' };
    expect(deriveExtractionReadiness(config)).toEqual({ kind: 'not-configured', missing: ['modelId'] });
  });

  it('names every missing field when more than one is missing', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: false };
    expect(deriveExtractionReadiness(config)).toEqual({
      kind: 'not-configured',
      missing: ['enabled', 'apiKey', 'modelId'],
    });
  });

  it('is ready when fully configured — no pattern-count threshold exists for this experiment', () => {
    const config: SemanticDeltaExtractorConfig = { enabled: true, apiKey: 'sk', modelId: 'm' };
    expect(deriveExtractionReadiness(config)).toEqual({ kind: 'ready' });
  });
});
