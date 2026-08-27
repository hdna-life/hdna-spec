/**
 * Shared identity fragment for every Trial 3 semantic-judge provider
 * (docs/decisions/0016's Trial 3 section) — the receipt-gated idempotency
 * *prompt/contract* version, independent of transport (OpenRouter vs.
 * local MLX vs. a future WebGPU provider) and independent of `modelId`.
 *
 * Each concrete provider's `providerId` is `` `${transport}/${SEMANTIC_REVISION_JUDGE_VERSION}` ``
 * (e.g. `openrouter/deterministic-semantic-judge-v3`,
 * `local-mlx/deterministic-semantic-judge-v3`) — so a transport change
 * alone already produces a distinct extractor identity, without needing a
 * version bump here every time the transport changes. This is exactly why
 * switching Trial 3's real run from OpenRouter/`qwen/qwen3-1.7b` to local
 * MLX/`Qwen/Qwen3-0.6B` does not require (and must not use) a shared
 * receipt identity: a previous OpenRouter Trial 3 attempt's receipts
 * (`openrouter/deterministic-semantic-judge-v3`) can never suppress a new
 * local-MLX Trial 3 run (`local-mlx/deterministic-semantic-judge-v3`), and
 * vice versa — the operator never needs to manually clear receipts to
 * switch transport.
 *
 * Bump this only when the narrow semantic-judge *contract itself*
 * (`SemanticRevisionJudgeInput`/`SemanticRevisionJudgmentDraft`, or the
 * admission/localization architecture around it) changes — not for a
 * transport or model change, which the `${transport}/` prefix and
 * `modelId` already distinguish.
 */
export const SEMANTIC_REVISION_JUDGE_VERSION = 'deterministic-semantic-judge-v3';
