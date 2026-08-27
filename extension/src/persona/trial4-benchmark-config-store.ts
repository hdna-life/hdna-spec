const CONFIG_KEY = 'hdna_trial4_benchmark_config';

/**
 * Trial 4's blind-benchmark config (docs/decisions/0017) — three endpoints
 * for the three anonymized systems compared per case: two local MLX-LM
 * servers (base Qwen3-0.6B, and the same model with the trained LoRA
 * adapter loaded via a second `mlx_lm.server --adapter-path ...` instance
 * on a different port — see `training/phase5a/README.md`) plus DeepSeek's
 * cloud API as the frontier reference. Deliberately a separate store from
 * `SemanticRevisionJudgeConfigStore` (Trial 3's single-endpoint config):
 * Trial 4 needs three endpoints live simultaneously, and DeepSeek's API
 * key must never be conflated with, or accidentally reused as, an
 * OpenRouter/local config.
 */
export interface Trial4BenchmarkConfig {
  /** Opt-in, defaults false — same discipline as every other experimental config store in this codebase. */
  enabled: boolean;
  /** e.g. "http://127.0.0.1:8080" — untrained/base Qwen3-0.6B local MLX-LM server. */
  baseModelUrl?: string;
  /** e.g. "http://127.0.0.1:8081" — the same model served with the trained LoRA adapter loaded. */
  trainedModelUrl?: string;
  /** Model id sent to both local MLX-LM servers — expected to be the same base model id for both (e.g. "Qwen/Qwen3-0.6B"), since only the adapter differs between them. */
  localModelId?: string;
  deepSeekApiKey?: string;
  /** e.g. "deepseek-v4-flash" — verify against the operator's actual DeepSeek account/available models; never defaulted by this store. */
  deepSeekModelId?: string;
}

const DEFAULT_CONFIG: Trial4BenchmarkConfig = {
  enabled: false,
};

/**
 * Holds Trial 4 benchmark endpoint/model/enabled preferences. Same
 * `chrome.storage.local`-direct pattern as every other experimental config
 * store in this codebase (not `StorageAdapter`/IndexedDB) — local config,
 * not persona evidence, not encrypted beyond whatever Chrome provides.
 */
export class Trial4BenchmarkConfigStore {
  async get(): Promise<Trial4BenchmarkConfig> {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const stored = result[CONFIG_KEY] as Trial4BenchmarkConfig | undefined;
    return stored ?? DEFAULT_CONFIG;
  }

  async set(config: Trial4BenchmarkConfig): Promise<void> {
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
  }
}
