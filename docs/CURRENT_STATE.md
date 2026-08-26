# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

Phase 4 — deterministic PATTERNS layer of the persona compiler, no model call
(see `docs/decisions/0011`). Phase 0, Phase 1, Phase 2's first slice, and all
of Phase 3 (3A/3B/3C) are complete. Phase 4's TRAITS/BELIEFS step (requires
an actual LLM call) is explicitly not started — its own future decision.
Also includes a post-3C fix: `HeuristicTinyClassifier` was silently
English-only, saturating/biasing on non-English (Turkish) evidence — see
`docs/decisions/0012`. And a post-3A fix: the resource governor's
`DEEP_IDLE` mode selection was gated on an empty queue, which made any
pending `P3` job self-blocking (its own presence in the backlog prevented
the only mode that could dispatch it) — see `docs/decisions/0013`.

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, Phase 1 cold-start data
collection, a first Phase 2 passive-collection slice, Phase 3
(batching/eviction infra, embeddings/retrieval, and T2 classifiers), and
Phase 4's deterministic PATTERNS layer:

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 223 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet, writing samples, edit events/metrics/profile,
  storage policy, embeddings, T2 dimensions/trait scores/profile, patterns,
  `.hdna` manifest shape.
- Phase 1 onboarding: real writing samples -> deterministic T0 stylometry ->
  Expression Sheet compilation, synchronous (see `docs/decisions/0004`).
- Phase 2 (first slice): AI-output/human-edit pairs, captured manually in the
  popup, processed asynchronously through the job queue (P1) -> T0 diff
  metrics -> T1 incremental profile (see `docs/decisions/0005`).
- Phase 3A: dispatch is mode-gated (INTERACTIVE/BACKGROUND/DEEP_IDLE actually
  restrict which job priorities run), foreground activity is real (popup-open
  detection via `chrome.runtime.Port`), and storage eviction (CACHE→DERIVED→RAW,
  CANONICAL never automatic) actually runs (see `docs/decisions/0008`).
- Phase 3B: `EmbeddingProvider` (execution-context-agnostic interface) +
  `HashingEmbeddingProvider` (deterministic, non-semantic baseline) +
  `VectorIndexService` (rebuildable index over canonical evidence) +
  `cosineSimilarity`/`queryNearest` retrieval primitives. Incremental
  indexing is `P2`, full rebuild is `P3`, both through the existing job
  queue; query-time embedding runs directly in the popup (see
  `docs/decisions/0009`).
- Phase 3C: `TinyClassifier` (execution-context-agnostic interface) +
  `HeuristicTinyClassifier` (deterministic, heuristic baseline covering only
  formality + directness — the other five T2 dimensions stay
  `SPEC_RESERVED`) + `TraitClassifierService` (idempotent classify + atomic
  profile fold-in, rebuildable from evidence, same pattern as
  `VectorIndexService`). Confidence-weighted incremental aggregation in
  `T2Profile`. `classify_evidence` is `P2`, `rebuild_t2_profile` is `P3`
  (see `docs/decisions/0010`).
- Phase 4 (PATTERNS layer): `PatternCompilerService` aggregates
  `EditMetrics`/`TraitScoreRecord` into context-scoped `Pattern` records
  (context resolved from evidence's `context.surface`, defaulting to
  `"unscoped"`), gated by an explicit evidence threshold
  (`PatternCompilerPolicy`) — no `Pattern` is emitted below threshold.
  `compile_patterns` is `P3`, manually triggered. TRAITS/BELIEFS (requires an
  LLM call) is not implemented — see `docs/decisions/0011`.
- Post-3C fix: real-world Turkish evidence (35 samples) exposed that
  `HeuristicTinyClassifier` was silently English-only — `directness`
  saturated at a confidently-wrong 100%, `formality` was biased upward.
  Fixed with `isLikelyEnglish()`, which requires BOTH a non-ASCII-letter
  ratio ≤ 2% AND English function-word density ≥ 5%. The first version used
  only the non-ASCII signal; the operator rejected it and requested an
  ASCII-only-Turkish regression test, which exposed that diacritic-free
  non-English text (common in real typing) passes a character-only check —
  the function-word signal closes that gap. Both dimensions abstain (omit
  entirely) rather than emit a fabricated value when the gate fails — see
  `docs/decisions/0012`.

## Implemented capabilities

- `IndexedDbStorageAdapter`: get/put/delete/query, per-storage-class byte usage,
  `putMany` (atomic multi-key write via one IDBTransaction).
- `JobQueue`: enqueue, priority+FIFO ordering, `runNext`, `countsByPriority`,
  persists through `StorageAdapter`. At-least-once: `RUNNING` jobs whose lease
  (`startedAt`) expires (default 5 min) are reclaimed back to `PENDING` and
  retried, so a job interrupted mid-execution by MV3 service-worker
  termination is not lost — see `docs/decisions/0007`.
- `resource-governor.decide()`: pure function, INTERACTIVE/BACKGROUND/DEEP_IDLE
  mode selection driven by foreground activity + sustained idleness
  (`idleTicks`, threaded across calls like `batchSize`) — never by queue
  backlog, which previously made pending `P3` jobs self-blocking; see
  `docs/decisions/0013`. Batch-size halving/doubling on latency ratio
  unchanged.
- `RuntimeControls`: persisted `processingPaused`/`learningPaused` state.
- `stylometry.ts`: deterministic T0 extractors — sentence/word splitting,
  sentence-length distribution, punctuation-per-100-sentences, lowercase-start
  probability, emoji-per-word rate. No model calls, no randomness.
- `compileExpressionSheet()`: samples -> `ExpressionSheet`, populates only
  MVP_REQUIRED fields (asserted by test), never SPEC_RESERVED ones.
- `WritingSampleStore` (CANONICAL) / `ExpressionSheetStore` (DERIVED,
  rebuildable from samples at any time).
- `levenshteinDistance` / `jaccardWordOverlap` / `computeEditMetrics`: pure T0
  diff extractors over an EditEvent (AI text vs. human-edited final text).
- `applyEditMetrics()`: numerically-stable online mean update, no history
  rescan — folds one new EditMetrics into the running EditProfile.
- `EditEventStore` (CANONICAL) / `EditMetricsStore` (DERIVED, per-event) /
  `EditProfileStore` (DERIVED, running aggregate).
- `captureEditEvent()`: persist + enqueue P1 job, returns immediately — the
  actual T0/T1 computation runs later in the background dispatch loop.
- `process_edit_event` processor is idempotent: `EditMetrics.profileAppliedAt`
  is the receipt that stops a reclaimed/replayed job from double-counting
  `EditProfile`; the metrics write and profile write land atomically via
  `putMany()` so no crash window can leave the receipt and the profile
  update out of sync (`docs/decisions/0007`).
- Popup UI: onboarding textarea + Expression Sheet summary + edit-capture form
  + Edit Profile summary + real governor mode + last-eviction info, wired to
  live queue/storage/controls state, polls every 2s.
- `chrome.alarms`-driven background dispatch loop running the `noop` and
  `process_edit_event` processors, now mode-gated: `JobQueue.next()`/`runNext()`
  accept an `allowedPriorities` filter, and dispatch is restricted to
  `ALLOWED_PRIORITIES_BY_MODE[mode]` each tick.
- `ForegroundTracker`: tracks whether the popup is open via a long-lived
  `chrome.runtime.Port`, feeding the governor's real `foregroundActive` signal
  (previously hardcoded `false`).
- `planEviction()` (pure) / `evictIfNeeded()`: evicts CACHE, then DERIVED,
  then RAW records until back under `DEFAULT_STORAGE_POLICY.maxTotalBytes`;
  CANONICAL is never evicted automatically. Runs each dispatch tick, deletions
  skipped while `mode === 'INTERACTIVE'`.
- `RuntimeStatusStore`: persists the background loop's live
  `{ mode, batchSize, lastEvictionAt, lastEvictionBytesFreed }` (CACHE class)
  so the popup, a separate execution context, can display it.
- `HashingEmbeddingProvider`: deterministic FNV-1a character-3-gram hashing
  trick, L2-normalized, 128 dimensions. Non-semantic by design — see
  `docs/decisions/0009`.
- `VectorIndexService`: `indexOne()`, `rebuild()` (discards and recomputes
  the entire index from every registered canonical evidence source —
  `writing_sample` and `edit_event`, the latter embedding the human-edited
  `finalText`), `query()`.
- `EmbeddingStore` (`DERIVED`, keyed by `sourceType:sourceId`).
- Popup UI: Vector Index panel — embedding count, extractor id/version,
  "Rebuild index" button, similarity search (results show
  `sourceType:sourceId (score)`, no text-snippet resolution yet).
- `HeuristicTinyClassifier`: deterministic formality (word length,
  contraction/emoji/exclamation rate) and directness (hedge-phrase
  frequency) scoring, 0-confidence for empty text, confidence saturating at
  20 words. Non-validated heuristics, explicitly documented as such — see
  `docs/decisions/0010`.
- `applyTraitScore()`: confidence-weighted incremental mean per T2 dimension
  — same "no history rescan" principle as `applyEditMetrics()`.
- `TraitScoreStore` / `T2ProfileStore` (`DERIVED`).
- `TraitClassifierService`: `classifyOne()` (idempotent via
  `TraitScoreRecord.profileAppliedAt`, atomic dual-write) / `rebuild()`
  (discards and recomputes from `writing_sample` + `edit_event` sources,
  reusing the exact `embedding-sources.ts` adapters from Phase 3B).
- Popup UI: Behavioral Estimates (T2) panel — formality/directness as
  percentages with sample counts, explicit "heuristic estimates, not
  established traits" note, "Rebuild T2 Profile" button (enqueues the
  existing `rebuild_t2_profile` P3 job — same rebuild UX as the Vector
  Index panel's button).
- `aggregateObservations()`: pure, threshold-gated confidence-weighted
  aggregation by (dimension, context) — same weighting principle as
  `applyTraitScore()`.
- `PatternStore` (`DERIVED`, keyed by `dimension:context`).
- `PatternCompilerService.compile()`: full rebuild from `EditMetrics`
  (`compressionRatio`, `lexicalOverlap`) and `TraitScoreRecord`
  (`formality`, `directness`), context resolved per-record from the source
  evidence. Mirrors `VectorIndexService`'s rebuild contract.
- Popup UI: Patterns panel — dimension/context/value/sample-count list,
  "Compile patterns" button.

## Known limitations

- `DEEP_IDLE_AFTER_IDLE_TICKS = 3` (roughly 90s at the current ~30s dispatch
  cadence) is a placeholder tuning value, not derived from measurement —
  see `docs/decisions/0013`.
- No retry cap on stale-RUNNING reclaim: a job that reliably crashes the
  service worker every time it runs would be retried indefinitely rather
  than eventually marked `FAILED`. Not implemented — see `docs/decisions/0007`.
- `putMany()`'s atomicity currently relies on `IndexedDbStorageAdapter`
  keeping all records in one physical object store. A future SQLite/OPFS
  adapter would need its own transaction mechanism to preserve this
  guarantee behind the same `StorageAdapter` interface.
- Eviction budget (50 MB) is a hardcoded placeholder, not user-configurable —
  see `docs/decisions/0008`.
- Within-class eviction order is not LRU/recency-based, just whatever
  `listRecordMeta()` returns — see `docs/decisions/0008`.
- `foregroundActive` only reflects "is the popup open," not other foreground
  signals the doc mentions (tab focus, recent interaction latency).
- `HashingEmbeddingProvider` is not semantic — retrieval reflects character/
  lexical overlap, not meaning. Explicit, accepted tradeoff, not a bug — see
  `docs/decisions/0009`.
- `queryNearest` is a linear scan, not an ANN index — fine at MVP scale,
  untested beyond it.
- No UI resolution from a vector-search result back to its source text.
- `HeuristicTinyClassifier`'s formality/directness scores are crude,
  non-validated heuristics — explicit, accepted tradeoff, not a bug — see
  `docs/decisions/0010`.
- T2 confidence only reflects word count within the English-gated path —
  genre and other factors beyond language-applicability still aren't
  modeled. See `docs/decisions/0012` for the language-gate fix.
- `isLikelyEnglish()` doesn't attempt general language identification —
  non-English text that is both ASCII-only *and* happens to reuse enough
  English function words (rare, but conceivable for heavily code-mixed
  text) could still pass. Intentional, documented scope boundary — see
  `docs/decisions/0012`.
- No UI currently sets `context.surface` on writing samples or edit events,
  so in practice all pattern observations fall into the `"unscoped"` bucket
  today — the context-scoping architecture is correct and tested, just not
  yet exercised with real multi-context data. See `docs/decisions/0011`.
- Pattern dimensions are limited to what existing derived evidence exposes
  (`compressionRatio`, `lexicalOverlap`, `formality`, `directness`) —
  `editDistance`/`sentenceCountChange` excluded as unbounded raw counts.
- `PatternCompilerService.compile()` is a full rebuild, not incremental —
  acceptable for this job's `P3`/expensive-rare classification.

## Known gaps (intentionally deferred, not bugs)

- No live/passive capture — evidence only arrives via explicit user action
  (onboarding samples, manual edit-event form). Content-script-based live
  capture across web pages is `PLANNED`, pending a separate operator decision
  on `host_permissions` scope and privacy review (`docs/decisions/0005`).
- No character n-grams, typo-pattern detection, response-latency, or
  keystroke/session telemetry yet (Phase 2 T0 items not yet built).
- Five of seven T2 dimensions (warmth, assertiveness, politeness, emotional
  intensity, sarcasm likelihood) remain `SPEC_RESERVED` — typed, never
  computed. Sarcasm specifically needs conservative handling a simple
  heuristic can't provide — see `docs/decisions/0010`.
- EditProfile, the vector index, the T2 profile, and now Patterns are not
  yet wired into the Expression Sheet or any retrieval-for-generation flow —
  that integration belongs to Phase 5 (retrieval runtime), not this slice.
- Phase 4's TRAITS/BELIEFS step — turning Patterns into higher-level claims
  via "rare persona-model interpretation" — requires an actual LLM call and
  is entirely unimplemented, pending its own model/provider decision. No
  provider abstraction, API key handling, or network permission exists yet.
  See `docs/decisions/0011`.
- No real (neural) embedding model or trained classifier, no WebGPU model.
- Governor's WebGPU-contention/battery/memory-pressure signals are typed
  (`SPEC_RESERVED`) but unwired — nothing produces them yet.
- Expression Sheet's SPEC_RESERVED fields (prosody, gesture, formality,
  directness, warmth) remain unpopulated by design.
- Sentence splitting is a naive regex (no abbreviation/decimal handling) —
  acceptable for T0 per the doc, documented in `stylometry.ts`.
- `.hdna` manifest type exists; no compiler/export pipeline.
- SQLite WASM + OPFS (doc's original Phase 0 storage mandate) not implemented —
  see `docs/decisions/0001-storage-indexeddb-first.md`.

## Current experiments / pending decisions

None open. Thirteen operator decisions to date are recorded in `docs/decisions/`.
One decision (`0005`) is a scope boundary awaiting a future explicit operator
call: whether/how to add content-script-based live capture. Future work, each
`PLANNED` pending its own decision: a real neural embedding provider
(swapping `HashingEmbeddingProvider`, likely needing an offscreen-document
execution context per `docs/decisions/0009`); a real trained classifier or
additional heuristic T2 dimensions (`docs/decisions/0010`); Phase 4's
TRAITS/BELIEFS step — the project's first LLM/network dependency, its own
model/provider decision (`docs/decisions/0011`); and Phase 5 (retrieval
runtime) to actually wire derived signals into anything user-facing.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
