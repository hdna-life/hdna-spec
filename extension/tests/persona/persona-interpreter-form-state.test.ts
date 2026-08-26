import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_ID_PLACEHOLDER,
  computeFormHydration,
  deriveInterpretationReadiness,
  resolveSavedConfig,
} from '../../src/persona/persona-interpreter-form-state';
import type { PersonaInterpreterConfig } from '../../src/persona/persona-interpreter-config-store';

describe('computeFormHydration', () => {
  it('hydrates fields from the initial placeholder default config, before the async persisted config loads', () => {
    const placeholderDefault: PersonaInterpreterConfig = { enabled: false };
    expect(computeFormHydration(false, placeholderDefault)).toEqual({
      apiKeyInput: '',
      modelIdInput: DEFAULT_MODEL_ID_PLACEHOLDER,
      enabledInput: false,
    });
  });

  it('re-hydrates once the real persisted config arrives a tick later — regression for the original close/reopen bug', () => {
    // App.svelte passes { enabled: false } first (before chrome.storage.local
    // resolves), then a second time with the real saved config once it does.
    // A one-shot "initialized" latch (the original bug) would apply only the
    // first call and never accept the second; computeFormHydration must not
    // have any such latch — every call is independent.
    const placeholderDefault: PersonaInterpreterConfig = { enabled: false };
    const persistedConfig: PersonaInterpreterConfig = {
      enabled: true,
      apiKey: 'sk-or-secret',
      modelId: 'anthropic/claude-3.5-sonnet',
    };

    computeFormHydration(false, placeholderDefault); // first call, as at mount
    const secondResult = computeFormHydration(false, persistedConfig); // async load resolves

    expect(secondResult).toEqual({
      apiKeyInput: '',
      modelIdInput: 'anthropic/claude-3.5-sonnet',
      enabledInput: true,
    });
  });

  it('never re-inserts the saved API key into the input, even once persisted config is hydrated', () => {
    const config: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk-or-secret' };
    expect(computeFormHydration(false, config)?.apiKeyInput).toBe('');
  });

  it('returns null while dirty, so the parent refresh poll can never clobber an in-progress edit', () => {
    const config: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk-or-secret', modelId: 'some/model' };
    expect(computeFormHydration(true, config)).toBeNull();
  });

  it('ignores a changed config entirely while dirty, even if the change is a legitimate save round-trip', () => {
    const beforeSave: PersonaInterpreterConfig = { enabled: false };
    const afterSave: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk-or-new', modelId: 'm1' };
    expect(computeFormHydration(true, beforeSave)).toBeNull();
    expect(computeFormHydration(true, afterSave)).toBeNull();
  });
});

describe('resolveSavedConfig', () => {
  it('uses the newly-typed API key when the field is non-empty', () => {
    const fields = { apiKeyInput: 'sk-or-new', modelIdInput: 'm1', enabledInput: true };
    const currentConfig: PersonaInterpreterConfig = { enabled: false, apiKey: 'sk-or-old' };
    expect(resolveSavedConfig(fields, currentConfig)).toEqual({ enabled: true, modelId: 'm1', apiKey: 'sk-or-new' });
  });

  it('preserves the existing saved key when the field is left blank, rather than wiping it out', () => {
    const fields = { apiKeyInput: '', modelIdInput: 'm2', enabledInput: false };
    const currentConfig: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk-or-old' };
    expect(resolveSavedConfig(fields, currentConfig)).toEqual({ enabled: false, modelId: 'm2', apiKey: 'sk-or-old' });
  });

  it('treats a whitespace-only field the same as blank', () => {
    const fields = { apiKeyInput: '   ', modelIdInput: 'm2', enabledInput: false };
    const currentConfig: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk-or-old' };
    expect(resolveSavedConfig(fields, currentConfig).apiKey).toBe('sk-or-old');
  });

  it('leaves apiKey undefined when the field is blank and nothing was ever saved', () => {
    const fields = { apiKeyInput: '', modelIdInput: 'm3', enabledInput: false };
    const currentConfig: PersonaInterpreterConfig = { enabled: false };
    expect(resolveSavedConfig(fields, currentConfig)).toEqual({ enabled: false, modelId: 'm3', apiKey: undefined });
  });
});

describe('deriveInterpretationReadiness', () => {
  it('is not-configured when disabled', () => {
    const config: PersonaInterpreterConfig = { enabled: false, apiKey: 'sk', modelId: 'm' };
    expect(deriveInterpretationReadiness(config, true)).toBe('not-configured');
  });

  it('is not-configured when enabled but missing an api key', () => {
    const config: PersonaInterpreterConfig = { enabled: true, modelId: 'm' };
    expect(deriveInterpretationReadiness(config, true)).toBe('not-configured');
  });

  it('is not-configured when enabled with a key but missing a model id', () => {
    const config: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk' };
    expect(deriveInterpretationReadiness(config, true)).toBe('not-configured');
  });

  it('is below-threshold when fully configured but not eligible', () => {
    const config: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk', modelId: 'm' };
    expect(deriveInterpretationReadiness(config, false)).toBe('below-threshold');
  });

  it('is ready when fully configured and eligible', () => {
    const config: PersonaInterpreterConfig = { enabled: true, apiKey: 'sk', modelId: 'm' };
    expect(deriveInterpretationReadiness(config, true)).toBe('ready');
  });
});
