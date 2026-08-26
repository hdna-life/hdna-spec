const CONFIG_KEY = 'hdna_semantic_revision_judge_config';

/**
 * Trial 3's own config (docs/decisions/0016's Trial 3 section) —
 * deliberately a separate store from `SemanticDeltaExtractorConfigStore`
 * (Trial 0-2's OpenRouter config), not a reuse of it. Trial 3's real
 * transport is now a local MLX-LM server, not OpenRouter: there is no
 * `apiKey` field at all, and the previous OpenRouter-transport Trial 3
 * config (a temporary reuse of `SemanticDeltaExtractorConfigStore`) is
 * fully replaced by this store. Keeping Trial 0-2's `apiKey` field far
 * away from this store is intentional, not incidental — it makes it
 * structurally impossible for a cloud API key to leak into a request this
 * store's config drives, since the field doesn't exist here at all.
 *
 * No `provider` discriminant field: local MLX is currently the only
 * supported Trial 3 transport, and adding a discriminant for a single
 * variant would be exactly the "large generic provider-management system"
 * Trial 3's brief explicitly warns against building. A future WebGPU
 * transport (see docs/decisions/0016's Trial 3 "Do not implement yet"
 * list) would be a deliberate follow-up change to this store, not
 * something pre-built here speculatively.
 */
export interface SemanticRevisionJudgeConfig {
  /** Opt-in, defaults false — same discipline as SemanticDeltaExtractorConfig.enabled. */
  enabled: boolean;
  /** e.g. "http://127.0.0.1:8080" — the local MLX-LM server's base URL, no trailing slash expected. */
  baseUrl?: string;
  /** e.g. "Qwen/Qwen3-0.6B" — sent verbatim as the request's "model" field; never defaulted/overridden by this store. */
  modelId?: string;
}

const DEFAULT_CONFIG: SemanticRevisionJudgeConfig = {
  enabled: false,
};

/**
 * Holds Trial 3's local-MLX base URL/model/enabled preferences. Same
 * `chrome.storage.local`-direct pattern (not `StorageAdapter`/IndexedDB) as
 * `SemanticDeltaExtractorConfigStore`/`PersonaInterpreterConfigStore` — this
 * is local config, not persona evidence. Plain local browser storage, not
 * cryptographic secret protection — moot here anyway, since there is no
 * secret to protect (no API key field).
 */
export class SemanticRevisionJudgeConfigStore {
  async get(): Promise<SemanticRevisionJudgeConfig> {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const stored = result[CONFIG_KEY] as SemanticRevisionJudgeConfig | undefined;
    return stored ?? DEFAULT_CONFIG;
  }

  async set(config: SemanticRevisionJudgeConfig): Promise<void> {
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
  }
}
