import type { SemanticRevisionJudgeConfig } from './semantic-revision-judge-config-store';

export interface SemanticRevisionJudgeFormFields {
  baseUrlInput: string;
  modelIdInput: string;
  enabledInput: boolean;
}

/**
 * Mirrors `semantic-delta-extractor-form-state.ts`'s `computeFormHydration`
 * exactly (same App.svelte placeholder-then-async-config shape, same fix
 * for the settings-form hydration bug documented in
 * docs/decisions/0015 — no one-shot `initialized` latch). No API-key
 * masking logic here (unlike the OpenRouter form state) — there is no
 * secret field in `SemanticRevisionJudgeConfig` to hide, so `baseUrlInput`/
 * `modelIdInput` hydrate directly from the persisted config, same as any
 * ordinary (non-secret) field would.
 */
export function computeFormHydration(
  dirty: boolean,
  config: SemanticRevisionJudgeConfig,
): SemanticRevisionJudgeFormFields | null {
  if (dirty) return null;
  return {
    baseUrlInput: config.baseUrl ?? '',
    modelIdInput: config.modelId ?? '',
    enabledInput: config.enabled,
  };
}

/**
 * Resolves what to persist on Save. Empty inputs persist as `undefined`
 * (not `''`), so `deriveJudgeReadiness` correctly reports them as missing
 * rather than "set to empty string" — same convention as
 * `resolveSavedConfig` in `semantic-delta-extractor-form-state.ts`.
 */
export function resolveSavedConfig(fields: SemanticRevisionJudgeFormFields): SemanticRevisionJudgeConfig {
  const trimmedBaseUrl = fields.baseUrlInput.trim();
  const trimmedModelId = fields.modelIdInput.trim();
  return {
    enabled: fields.enabledInput,
    baseUrl: trimmedBaseUrl.length > 0 ? trimmedBaseUrl : undefined,
    modelId: trimmedModelId.length > 0 ? trimmedModelId : undefined,
  };
}

export type SemanticRevisionJudgeMissingField = 'enabled' | 'baseUrl' | 'modelId';

export type SemanticRevisionJudgeReadiness =
  | { kind: 'not-configured'; missing: SemanticRevisionJudgeMissingField[] }
  | { kind: 'ready' };

/**
 * Mirrors the exact pre-network guard
 * `SemanticRevisionJudgeExtractionService.runExperiment()` performs
 * (`!config.enabled || !config.baseUrl || !config.modelId`), so the UI and
 * the service can never disagree about whether a given state will make a
 * local HTTP request.
 */
export function deriveJudgeReadiness(config: SemanticRevisionJudgeConfig): SemanticRevisionJudgeReadiness {
  const missing: SemanticRevisionJudgeMissingField[] = [];
  if (!config.enabled) missing.push('enabled');
  if (!config.baseUrl) missing.push('baseUrl');
  if (!config.modelId) missing.push('modelId');
  if (missing.length > 0) return { kind: 'not-configured', missing };
  return { kind: 'ready' };
}
