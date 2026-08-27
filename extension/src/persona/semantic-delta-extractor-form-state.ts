import type { SemanticDeltaExtractorConfig } from './semantic-delta-extractor-config-store';

export interface SemanticDeltaExtractorFormFields {
  apiKeyInput: string;
  modelIdInput: string;
  enabledInput: boolean;
}

/**
 * Decides whether SemanticDeltaExtractionPanel's settings form should
 * (re)hydrate its input fields from the latest persisted config, or leave
 * them alone. Mirrors persona-interpreter-form-state.ts's
 * `computeFormHydration` exactly — same App.svelte placeholder-then-async-
 * config shape (a synchronous `{ enabled: false }` default on mount,
 * replaced a tick later by the real `chrome.storage.local` read), and the
 * same confirmed-bug fix: no one-shot `initialized` latch, since a latch
 * that fires on the first (placeholder) value would permanently ignore the
 * real config that arrives afterward. See
 * docs/decisions/0015's "Post-implementation fix: settings-form hydration
 * bug" section for the original incident this pattern fixes.
 *
 * Returns null while `dirty` (an in-progress, unsaved edit) — the popup's
 * 2s refresh() poll must never clobber that. Otherwise always recomputes
 * fresh from `config`.
 *
 * The API key is deliberately never hydrated into the input — it always
 * comes back blank, so a previously-saved secret isn't re-inserted into a
 * visible/editable field just because the popup was reopened. Whether a
 * key is already saved is surfaced separately (see the panel's `hasApiKey`),
 * never by exposing the value itself.
 */
export function computeFormHydration(
  dirty: boolean,
  config: SemanticDeltaExtractorConfig,
): SemanticDeltaExtractorFormFields | null {
  if (dirty) return null;
  return {
    apiKeyInput: '',
    modelIdInput: config.modelId ?? '',
    enabledInput: config.enabled,
  };
}

/**
 * Resolves what to actually persist on Save. A newly-typed API key wins;
 * an empty field preserves whatever key was already saved
 * (`currentConfig.apiKey`) rather than wiping it out just because the
 * input always renders blank by default (see computeFormHydration) — same
 * data-loss safeguard as persona-interpreter-form-state.ts's
 * `resolveSavedConfig`. An empty model id input is persisted as `undefined`
 * rather than `''`, so `deriveExtractionReadiness` correctly reports it as
 * missing rather than "set to empty string".
 */
export function resolveSavedConfig(
  fields: SemanticDeltaExtractorFormFields,
  currentConfig: SemanticDeltaExtractorConfig,
): SemanticDeltaExtractorConfig {
  const trimmedKey = fields.apiKeyInput.trim();
  const trimmedModelId = fields.modelIdInput.trim();
  return {
    enabled: fields.enabledInput,
    apiKey: trimmedKey.length > 0 ? trimmedKey : currentConfig.apiKey,
    modelId: trimmedModelId.length > 0 ? trimmedModelId : undefined,
  };
}

export type SemanticDeltaExtractionMissingField = 'enabled' | 'apiKey' | 'modelId';

/**
 * Unlike PersonaInterpretationReadiness (persona-interpreter-form-state.ts),
 * there is no `below-threshold` state here: Phase 5A has no pattern-count
 * eligibility gate — confirmed by SemanticDeltaExtractionService.runExperiment(),
 * whose only pre-network guard is `!config.enabled || !config.apiKey ||
 * !config.modelId`. Do not add a below-threshold variant without a matching
 * change to that guard clause.
 */
export type SemanticDeltaExtractionReadiness =
  | { kind: 'not-configured'; missing: SemanticDeltaExtractionMissingField[] }
  | { kind: 'ready' };

/**
 * Makes the pre-network gate in SemanticDeltaExtractionService.runExperiment()
 * observable in the UI *before* the user clicks "Extract semantic deltas" —
 * mirrors the exact same check the service itself performs, so the UI and
 * the service can never disagree about whether a given state will make a
 * network call.
 */
export function deriveExtractionReadiness(config: SemanticDeltaExtractorConfig): SemanticDeltaExtractionReadiness {
  const missing: SemanticDeltaExtractionMissingField[] = [];
  if (!config.enabled) missing.push('enabled');
  if (!config.apiKey) missing.push('apiKey');
  if (!config.modelId) missing.push('modelId');
  if (missing.length > 0) return { kind: 'not-configured', missing };
  return { kind: 'ready' };
}
