const CONFIG_KEY = 'hdna_trial4_benchmark_config';

/**
 * Trial 4's blind-benchmark config (docs/decisions/0017) — three endpoints
 * for the three anonymized systems compared per case: two local MLX-LM
 * servers (base Qwen3-0.6B, and the same model with the trained LoRA
 * adapter loaded via a second `mlx_lm.server --adapter-path ...` instance
 * on a different port — see `training/phase5a/README.md`) plus the
 * DeepSeek frontier reference, reached via OpenRouter (Test 1 evaluation-
 * stage addendum — we do NOT call DeepSeek's own direct API; see
 * `extension/entrypoints/background.ts`'s Trial 4 wiring, which constructs
 * an `OpenRouterSemanticRevisionJudge` for the `deepseek` role). Deliberately
 * a separate store from `SemanticRevisionJudgeConfigStore` (Trial 3's
 * single-endpoint config): Trial 4 needs three endpoints live
 * simultaneously, and this OpenRouter key must never be conflated with, or
 * accidentally reused as, a local-model config.
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
  /** OpenRouter API key — used ONLY for the `deepseek` reference role's requests, sent only to `https://openrouter.ai/api/v1/chat/completions`. Never DeepSeek's own API. */
  openRouterApiKey?: string;
  /** OpenRouter model id for the frontier-reference role, e.g. "deepseek/deepseek-chat-v3.1" — configurable, never defaulted/baked-in by this store or by any provider-construction code. */
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
