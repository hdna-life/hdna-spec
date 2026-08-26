# MVP Scope Classification — Foundation PR

Restates this PR's scope per `hdna-design-research-document.md`'s "MVP Scope
and Deferred Architecture Rule", so future agents don't need to re-read the
full source document to know what's in/out of scope for the codebase as it
stands after this PR.

## MVP_REQUIRED — implemented in this PR

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`, IndexedDB-backed).
- Persistent job queue (P0-P3 priority classes, survives SW termination).
- Resource governor skeleton (pure, latency/backlog-driven decisions).
- Runtime controls (pause processing vs. pause learning, persisted, distinct).
- Transparency UI (status, queue, storage usage, controls).
- Deterministic test infrastructure (vitest + fake-indexeddb).
- `spec/` protocol/schema type definitions: storage classes, evidence
  metadata, identity facts, Expression Sheet shape, writing sample shape,
  `.hdna` manifest shape.
- Phase 1 cold-start onboarding: `WritingSampleStore` (real samples, CANONICAL)
  + deterministic T0 stylometry extractors (`stylometry.ts`) +
  `compileExpressionSheet()` -> `ExpressionSheetStore` (DERIVED, rebuildable).
  Populates only the Expression Sheet's MVP_REQUIRED fields.
- Phase 2 first slice — AI-output/human-edit pairs as passive-learning
  evidence, captured manually (`docs/decisions/0005`), processed via the P1
  job queue: `EditEventStore` (CANONICAL) -> `computeEditMetrics()` (pure T0
  diff: Levenshtein distance, compression ratio, sentence-count change,
  Jaccard lexical overlap) -> `EditMetricsStore` (DERIVED) ->
  `applyEditMetrics()` (T1 incremental mean, no history rescan) ->
  `EditProfileStore` (DERIVED).
- Phase 3A — batching/scheduling and storage-eviction infrastructure
  (`docs/decisions/0008`): `JobQueue` dispatch is mode-gated via
  `ALLOWED_PRIORITIES_BY_MODE`; `foregroundActive` is a real signal
  (`ForegroundTracker`, popup-open detection via `chrome.runtime.Port`,
  replacing the previous hardcoded `false`); `planEviction()`/`evictIfNeeded()`
  actually run (CACHE→DERIVED→RAW, CANONICAL never automatic), deferred while
  `mode === 'INTERACTIVE'`.
- Phase 3B — local embeddings + vector index (`docs/decisions/0009`):
  `EmbeddingProvider` (execution-context-agnostic interface) implemented by
  `HashingEmbeddingProvider` (deterministic, explicitly non-semantic n-gram
  hashing baseline — no ML dependency); `VectorIndexService` with a
  `rebuild()` contract (embeddings are derived, never canonical, always
  reconstructable from evidence); `cosineSimilarity`/`queryNearest` retrieval
  primitives. Incremental indexing (`P2`) and full rebuild (`P3`) run through
  the existing job queue.
- Phase 3C — tiny local classifiers (`docs/decisions/0010`): `TinyClassifier`
  (execution-context-agnostic interface) implemented by
  `HeuristicTinyClassifier` (deterministic, explicitly non-validated
  heuristic baseline — no ML dependency), covering only formality and
  directness (the two T2 dimensions with the clearest heuristic signal).
  `TraitClassifierService` mirrors `VectorIndexService`'s rebuild contract
  and `edit-event-processor.ts`'s idempotency pattern (atomic receipt +
  profile write). Confidence-weighted incremental aggregation in
  `T2Profile`. Incremental classification (`P2`) and full rebuild (`P3`)
  run through the existing job queue.
- Phase 4 — deterministic PATTERNS layer only (`docs/decisions/0011`):
  `PatternCompilerService` aggregates `EditMetrics`/`TraitScoreRecord` into
  context-scoped `Pattern` records, context resolved from each observation's
  source evidence (`context.surface`, defaulting to `"unscoped"`), gated by
  an explicit evidence threshold (`PatternCompilerPolicy`) — no `Pattern`
  below threshold. `compile_patterns` (`P3`, full rebuild, manually
  triggered) mirrors `VectorIndexService`'s rebuild contract. The
  TRAITS/BELIEFS step (requires an LLM call) is explicitly not implemented —
  see PLANNED below.
- Post-3C fix (`docs/decisions/0012`): `HeuristicTinyClassifier`'s formality/
  directness heuristics are gated by `isLikelyEnglish()` — requires BOTH a
  non-ASCII-letter ratio ≤ 2% AND English function-word density ≥ 5% — and
  abstain (omit the dimension) for non-English text. Fixed after real
  Turkish evidence exposed a saturation/bias bug, then revised after an
  operator-requested ASCII-only-Turkish regression test exposed a gap in
  the first (non-ASCII-only) version of the gate.

## SPEC_RESERVED — typed, not implemented

- `GovernorSignals.webgpuContention` / `.batteryLevel` / `.memoryPressure` —
  fields exist on the type so the governor's function signature is stable,
  but nothing produces these signals and the governor's `decide()` logic does
  not read them.
- `ExpressionSheet.prosody`, `.gestureProfile`, `.formality`, `.directness`,
  `.warmth` — fields exist per the doc's canonical layers, explicitly tagged
  `SPEC_RESERVED` in `EXPRESSION_SHEET_FIELD_STATUS`, never populated. (Note:
  `T2Profile.formality`/`.directness` — the classifier output — are a
  separate, now-implemented type; wiring them into `ExpressionSheet` itself
  remains future work, see PLANNED below.)
- `T2Dimension`'s `warmth`, `assertiveness`, `politeness`,
  `emotionalIntensity`, `sarcasmLikelihood` — typed in `T2_DIMENSION_STATUS`,
  explicitly `SPEC_RESERVED`, never computed by `HeuristicTinyClassifier`.
- `.hdna` manifest shape (`spec/hdna-format/manifest.ts`) — typing only, no
  compiler/export pipeline.

## PLANNED — not started

- Phase 2 passive evidence capture at scale: content-script-based *live*
  capture of AI-output/human-edit pairs across web pages (this slice is
  manual-only, see `docs/decisions/0005`), character n-grams, typo-pattern
  detection, response latency, keystroke/session aggregation, full context
  metadata taxonomy (writing.public_social / writing.private_message / etc.).
- A real (neural) embedding provider, swapped in behind the existing
  `EmbeddingProvider` interface — its own future model/library decision,
  likely requiring an offscreen-document execution context
  (`docs/decisions/0009`). Also: benchmarking retrieval quality against a
  real semantic model, since the current baseline is explicitly non-semantic.
- A real trained classifier model, or heuristic coverage of the remaining
  five T2 dimensions — swapped in / added behind the existing
  `TinyClassifier` interface (`docs/decisions/0010`).
- Phase 4's TRAITS/BELIEFS step: turning `Pattern`s into higher-level claims
  via the doc's "T3: rare persona-model interpretation" — requires an actual
  LLM call (frontier API or local model). No provider abstraction, API key
  handling, or network permission exists yet — this is the project's first
  network dependency and needs its own explicit model/provider decision
  (`docs/decisions/0011`).
- Phase 5 retrieval runtime (query-focused persona assembly).
- Phase 6 WebGPU expression engine (the actual style-transform model).
- Phase 7 optional local neural adaptation (LoRA/adapters).
- Phase 8 multimodal activation (speech/visual/gesture).
- Phase 9 export/publish/self-host runtime.

## EXPERIMENTAL — not started, research-only

- Small (~sub-billion-parameter) persona expression model hypothesis
  (TinyStyler-adjacent) — requires semantic-preservation, persona-similarity,
  multilingual, and WebGPU-performance benchmarks before any implementation.

## What remains out of scope after this round

This PR adds the deterministic half of the Phase 4 persona compiler:
evidence-threshold-gated, context-scoped `Pattern` compilation from existing
derived signals (`EditMetrics`, `TraitScoreRecord`), with provenance and
compiler versioning. It deliberately stops before the doc's TRAITS/BELIEFS
step, which requires an actual LLM call — the project's first network
dependency — kept out pending its own explicit model/provider decision,
the same way embeddings and classifiers were split from their contract work.
It still does not implement: live/content-script capture, character
n-grams or other T0 signals beyond diffing, the remaining five T2
dimensions, a real semantic embedding model or trained classifier, LLM-based
trait/belief inference, wiring any derived signal (EditProfile, the vector
index, T2Profile, Patterns) into the Expression Sheet or a retrieval-for-
generation flow, the WebGPU expression transformation itself, user-
configurable storage limits, or any benchmark suite. Those remain the next
round(s) of work, unblocked by (not fulfilled by) this PR.
