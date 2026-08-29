# MVP Scope Classification

Classifies every capability in this codebase per
`hdna-design-research-document.md`'s "MVP Scope and Deferred Architecture
Rule", so a contributor doesn't need to re-read that source document (or
the full decision log) to know what's implemented, planned, or still
experimental. For current product status/direction, see
`docs/CURRENT_STATE.md` first — this file is the scope catalog, not the
status narrative.

## MVP_REQUIRED — implemented

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
- Phase 4 — deterministic PATTERNS layer (`docs/decisions/0011`):
  `PatternCompilerService` aggregates `EditMetrics`/`TraitScoreRecord` into
  context-scoped `Pattern` records, context resolved from each observation's
  source evidence (`context.surface`, defaulting to `"unscoped"`), gated by
  an explicit evidence threshold (`PatternCompilerPolicy`) — no `Pattern`
  below threshold. `compile_patterns` (`P3`, full rebuild, manually
  triggered) mirrors `VectorIndexService`'s rebuild contract.
- Phase 4 — T3 TRAITS/BELIEFS persona interpretation (`docs/decisions/0015`):
  the project's first network/LLM dependency. `PersonaInterpreterProvider`
  (execution-context-agnostic interface, no `fetch`/API-key concept)
  implemented by `OpenRouterPersonaInterpreter` (OpenRouter as a model
  gateway, `modelId` caller-configurable). `PersonaInterpreterService`
  gates any network call behind a deterministic evidence threshold
  (`PersonaInterpreterPolicy`), sends only minimized `PatternCandidate`
  aggregates (never raw evidence, never the previous claim set), validates
  structured responses (`validateClaimDraft`), and full-rebuild-writes
  `TraitBeliefClaim`s to `TraitBeliefStore` (`DERIVED`). `interpret_traits_beliefs`
  is `P3`, manually triggered, mirroring `compile_patterns`'s job shape.
  API key/model/enabled config lives in `chrome.storage.local`, explicitly
  outside the `CANONICAL`/`DERIVED`/`CACHE`/`RAW` persona storage taxonomy —
  a credential is not persona evidence and must never surface through
  storage-usage accounting, eviction, or a future persona-export/evidence
  API. `host_permissions` scoped to exactly `https://openrouter.ai/*`.
- Post-3C fix (`docs/decisions/0012`): `HeuristicTinyClassifier`'s formality/
  directness heuristics are gated by `isLikelyEnglish()` — requires BOTH a
  non-ASCII-letter ratio ≤ 2% AND English function-word density ≥ 5% — and
  abstain (omit the dimension) for non-English text. Fixed after real
  Turkish evidence exposed a saturation/bias bug, then revised after an
  operator-requested ASCII-only-Turkish regression test exposed a gap in
  the first (non-ASCII-only) version of the gate.

- Phase 5A — persona evidence utility validation (`docs/decisions/0016`),
  an explicit **operator-driven roadmap reordering** in response to the
  first real Phase 4/T3 dogfood finding: the current PATTERNS
  representation (`compressionRatio`, `lexicalOverlap`) is
  information-poor for persona construction, even though the T3 pipeline
  itself is confirmed working end to end. `SemanticDeltaExtractorProvider`
  (execution-context-agnostic interface) implemented by
  `OpenRouterSemanticDeltaExtractor`, orchestrated by
  `SemanticDeltaExtractionService` — per-source idempotent (not
  full-rebuild) via `SemanticDeltaExtractionReceipt`, since candidate
  existence alone can't represent a correct abstention (zero candidates).
  Extracts observation-centered `SemanticDeltaCandidate`s (never a
  trait/belief/pattern) from `EditEvent` AI-output/human-edit pairs,
  deliberately sending raw edit-pair text — a disclosed, opt-in-only
  privacy-boundary difference from T3, gated by its own independent
  `SemanticDeltaExtractorConfigStore`. `extract_semantic_deltas` is `P3`,
  manually triggered, mirroring `compile_patterns`'s job shape. Stops at
  OBSERVATION in the `CANONICAL -> OBSERVATION -> REPEATED PATTERN ->
  TRAIT/BELIEF` hierarchy — no semantic aggregation/promotion in this
  phase. This is superseded by Phase 5A Trial 4 / Test 1 below — see
  `docs/decisions/0016` for the full academic basis and pre-declared
  human-graded acceptance criteria this phase's own trials were scored
  against (historical detail: `docs/history/experiments/0016-phase5a-trials-history.md`).

- **Phase 5A Trial 4 / Test 1 — human-filtered tiny-model specialization
  (`docs/decisions/0017`): CLOSED — SUCCESS.** Validates that a
  sub-billion-parameter local model (`Qwen/Qwen3-0.6B`) can learn HDNA's
  v3 localized edit-judgment policy (`training/phase5a/lore/task-contract.v3.md`)
  via LoRA/SFT on a small human-reviewed dataset: `SemanticRevisionJudgeProvider`
  (execution-context-agnostic interface, same contract for local-MLX and
  OpenRouter transports), `Trial4BenchmarkService` (blind A/B/C three-way
  comparison — untrained base, trained, frontier DeepSeek reference — with
  frozen, locked ground truth and objective semantic/dimension metrics),
  the Dashboard's Benchmark page, and a standalone Python
  generate/review/train pipeline (`training/phase5a/`). Final result: 80%
  semantic-exact accuracy, 80% human-acceptable rate on a fresh 10-case
  held-out validation — see
  `training/phase5a/benchmark/test1-final-result.md`. Test 2 (synthetic
  filtered distillation, planned `google/gemma-3-270m-it` student) is the
  next active training work — see PLANNED below.

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
- A non-OpenRouter `PersonaInterpreterProvider`, per-request cost/rate
  limiting, or encryption-at-rest for the stored OpenRouter API key — T3
  itself is implemented, see `docs/decisions/0015`.
- A non-OpenRouter `SemanticDeltaExtractorProvider` (e.g. local inference),
  per-request cost/rate limiting for Phase 5A, or the optional (A)
  human-final-alone vs. (B) contrastive-delta control — Phase 5A extraction
  itself is implemented, see `docs/decisions/0016`.
- Semantic candidate clustering, repetition/evidence-threshold aggregation,
  and `SemanticPattern` promotion from `SemanticDeltaCandidate`s into the
  existing PATTERNS/TRAITS-BELIEFS hierarchy — superseded by Phase 5A
  Trial 4's judgment-based approach above; not being pursued further.
- **Test 2 — synthetic filtered distillation (next active training
  work).** Replaces Test 1's manual candidate review with an automated
  pipeline: policy/coverage spec -> frontier synthetic generation ->
  independent frontier verification/filtering -> schema+taxonomy
  validation -> dedup -> coverage balancing -> frozen synthetic corpus
  (~5,000 accepted examples) -> LoRA/SFT -> a completely fresh held-out
  benchmark. Planned student: `google/gemma-3-270m-it` (smaller,
  WebGPU-oriented, replacing `Qwen3-0.6B` as the target production
  student — `Qwen3-0.6B` served its purpose as the Test 1 feasibility
  student). See `training/phase5a/benchmark/test1-final-result.md`'s
  "Direct transition to Test 2" section. Not yet implemented.
- **Retrieval runtime and WebGPU expression engine** — the actual
  local behavior/transformation layer around frontier-model output
  (query-focused persona assembly, then the style-transform model
  itself). Depends on Test 2 producing a student small/fast enough for
  browser/WebGPU deployment; not started.
- Phase 7 optional local neural adaptation (LoRA/adapters) beyond the
  Test 1/Test 2 training track itself.
- Phase 8 multimodal activation (speech/visual/gesture).
- Phase 9 export/publish/self-host runtime.

## EXPERIMENTAL — not started, research-only

- Wiring the v3 edit-judgment output (`verdict` + `dimensions`) into the
  existing `EditProfile`/`T2Profile`/`Pattern`/`TraitBeliefClaim`
  aggregation hierarchy — the small-model judgment step itself is no
  longer experimental (Test 1 validated it), but aggregating its output
  into a user-specific behavioral representation, and eventually into a
  retrieval/transformation layer, remains unbuilt and unvalidated.
