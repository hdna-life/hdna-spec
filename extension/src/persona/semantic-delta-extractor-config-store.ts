const CONFIG_KEY = 'hdna_semantic_delta_extractor_config';

export interface SemanticDeltaExtractorConfig {
  /**
   * Opt-in, defaults false, and deliberately independent of
   * PersonaInterpreterConfig.enabled — enabling T3 must never silently
   * enable raw-text upload for this experiment. See docs/decisions/0016.
   */
  enabled: boolean;
  apiKey?: string;
  modelId?: string;
}

const DEFAULT_CONFIG: SemanticDeltaExtractorConfig = {
  enabled: false,
};

/**
 * Holds the OpenRouter API key and model/enabled preferences for Phase 5A
 * semantic delta extraction. Deliberately NOT backed by
 * StorageAdapter/IndexedDB — a credential is local secret/config state,
 * not persona evidence — same reasoning and same chrome.storage.local-direct
 * pattern as PersonaInterpreterConfigStore
 * (extension/src/persona/persona-interpreter-config-store.ts), kept as a
 * genuinely separate store (and separate opt-in) rather than reusing that
 * one, since Phase 5A sends raw edit-pair text — a materially different
 * privacy boundary from T3's minimized PatternCandidates.
 *
 * This is plain local browser storage, not cryptographic secret
 * protection. See docs/decisions/0016.
 */
export class SemanticDeltaExtractorConfigStore {
  async get(): Promise<SemanticDeltaExtractorConfig> {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const stored = result[CONFIG_KEY] as SemanticDeltaExtractorConfig | undefined;
    return stored ?? DEFAULT_CONFIG;
  }

  async set(config: SemanticDeltaExtractorConfig): Promise<void> {
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
  }
}
