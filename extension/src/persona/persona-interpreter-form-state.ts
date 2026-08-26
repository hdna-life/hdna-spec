import type { PersonaInterpreterConfig } from './persona-interpreter-config-store';

export const DEFAULT_MODEL_ID_PLACEHOLDER = 'openai/gpt-4o-mini';

export interface PersonaInterpreterFormFields {
  apiKeyInput: string;
  modelIdInput: string;
  enabledInput: boolean;
}

/**
 * Decides whether TraitsBeliefsSummary's settings form should (re)hydrate
 * its input fields from the latest persisted config, or leave them alone.
 *
 * Returns null while `dirty` (the user has an in-progress, unsaved edit) —
 * the popup's 2s refresh() poll must never clobber that.
 *
 * Otherwise always recomputes fresh from `config`, with no "only once"
 * latch. This is the fix for a real bug: the original component used a
 * one-shot `initialized` flag that hydrated from App.svelte's placeholder
 * default ({ enabled: false }, passed before the async
 * chrome.storage.local read resolves) and then locked, permanently
 * ignoring the real persisted config that arrived a tick later. Every
 * call here is independent — called again with the same (still dirty)
 * state is a no-op, called again with a new config always re-derives.
 *
 * The API key is deliberately never hydrated into the input — it always
 * comes back blank, so a previously-saved secret isn't re-inserted into a
 * visible/editable field just because the popup was reopened. Whether a
 * key is already saved is surfaced separately (see
 * TraitsBeliefsSummary's `hasApiKey`), never by exposing the value itself.
 */
export function computeFormHydration(
  dirty: boolean,
  config: PersonaInterpreterConfig,
): PersonaInterpreterFormFields | null {
  if (dirty) return null;
  return {
    apiKeyInput: '',
    modelIdInput: config.modelId ?? DEFAULT_MODEL_ID_PLACEHOLDER,
    enabledInput: config.enabled,
  };
}

/**
 * Resolves what to actually persist on Save. A newly-typed API key wins;
 * an empty field preserves whatever key was already saved
 * (`currentConfig.apiKey`) rather than wiping it out just because the
 * input always renders blank by default (see computeFormHydration).
 *
 * This also closes the likely real-world path that produced a fully
 * disabled/keyless config with zero OpenRouter traffic: before this fix,
 * reopening the popup showed Enabled unchecked and the key field empty
 * (the hydration bug above) — clicking Save in that state would silently
 * overwrite the real, working config with a blank/disabled one. With the
 * hydration fix alone this can no longer happen from a stale display, and
 * this merge is a second, independent safeguard against ever writing an
 * empty key over a real one.
 */
export function resolveSavedConfig(
  fields: PersonaInterpreterFormFields,
  currentConfig: PersonaInterpreterConfig,
): PersonaInterpreterConfig {
  const trimmedKey = fields.apiKeyInput.trim();
  return {
    enabled: fields.enabledInput,
    modelId: fields.modelIdInput,
    apiKey: trimmedKey.length > 0 ? trimmedKey : currentConfig.apiKey,
  };
}

export type PersonaInterpretationMissingField = 'enabled' | 'apiKey' | 'modelId';

export type PersonaInterpretationReadiness =
  | { kind: 'not-configured'; missing: PersonaInterpretationMissingField[] }
  | { kind: 'below-threshold' }
  | { kind: 'ready' };

/**
 * Makes the pre-network gate in PersonaInterpreterService.interpret()
 * observable in the UI *before* the user clicks "Interpret" — so a run
 * that makes zero OpenRouter requests (because it's unconfigured, or
 * because PatternStore doesn't yet have enough distinct patterns) never
 * has to be inferred after the fact from an empty OpenRouter dashboard.
 * Mirrors the exact same two pre-network exits
 * PersonaInterpreterService.interpret() itself checks, in the same order,
 * and — for `not-configured` — names exactly which field(s) are missing
 * rather than a single generic "not configured" verdict, so the operator
 * doesn't have to guess which deterministic condition actually failed.
 */
export function deriveInterpretationReadiness(
  config: PersonaInterpreterConfig,
  eligible: boolean,
): PersonaInterpretationReadiness {
  const missing: PersonaInterpretationMissingField[] = [];
  if (!config.enabled) missing.push('enabled');
  if (!config.apiKey) missing.push('apiKey');
  if (!config.modelId) missing.push('modelId');
  if (missing.length > 0) return { kind: 'not-configured', missing };
  if (!eligible) return { kind: 'below-threshold' };
  return { kind: 'ready' };
}
