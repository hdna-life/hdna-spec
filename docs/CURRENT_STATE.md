# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

Phase 3C — tiny local classifiers, heuristic baseline, formality + directness
only (see `docs/decisions/0010`). Phase 0, Phase 1, Phase 2's first slice,
Phase 3A (batching/eviction infra), and Phase 3B (embeddings/vector index)
are complete. All of Phase 3 (3A/3B/3C) is now done.

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, Phase 1 cold-start data
collection, a first Phase 2 passive-collection slice, and Phase 3
(batching/eviction infra, embeddings/retrieval, and T2 classifiers):

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 176 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet, writing samples, edit events/metrics/profile,
  storage policy, embeddings, T2 dimensions/trait scores/profile, `.hdna`
  manifest shape.
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

## Implemented capabilities

- `IndexedDbStorageAdapter`: get/put/delete/query, per-storage-class byte usage,
  `putMany` (atomic multi-key write via one IDBTransaction).
- `JobQueue`: enqueue, priority+FIFO ordering, `runNext`, `countsByPriority`,
  persists through `StorageAdapter`. At-least-once: `RUNNING` jobs whose lease
  (`startedAt`) expires (default 5 min) are reclaimed back to `PENDING` and
  retried, so a job interrupted mid-execution by MV3 service-worker
  termination is not lost — see `docs/decisions/0007`.
- `resource-governor.decide()`: pure function, INTERACTIVE/BACKGROUND/DEEP_IDLE
  mode selection, batch-size halving/doubling on latency ratio.
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
  established traits" note.

## Known limitations

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
- T2 confidence only reflects word count, not genre/language/other factors
  that would affect heuristic reliability.

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
- EditProfile, the vector index, and the T2 profile are not yet wired into
  the Expression Sheet or any retrieval-for-generation flow — that
  integration belongs to the Phase 4 persona compiler / Phase 5 retrieval
  runtime, not this slice.
- No real (neural) embedding model or trained classifier, no persona
  compiler, no WebGPU model.
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

None open. Ten operator decisions to date are recorded in `docs/decisions/`.
One decision (`0005`) is a scope boundary awaiting a future explicit operator
call: whether/how to add content-script-based live capture. Phase 3 is now
fully complete (3A/3B/3C). Future work, each `PLANNED` pending its own
decision: a real neural embedding provider (swapping
`HashingEmbeddingProvider`, likely needing an offscreen-document execution
context per `docs/decisions/0009`); a real trained classifier or additional
heuristic T2 dimensions (`docs/decisions/0010`); and Phase 4 (persona
compiler) to actually use these derived signals for anything.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
