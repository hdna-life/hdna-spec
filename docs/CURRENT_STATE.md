# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

Phase 3A — batching/scheduling and storage-eviction infrastructure (see
`docs/decisions/0008`). Phase 0 (spec/runtime contracts), Phase 1 (cold-start
onboarding), and Phase 2's first slice (manual edit-event capture) are
complete. Phase 3B (embeddings + vector index) and 3C (tiny classifiers) are
scoped but not started — see Current experiments below.

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, Phase 1 cold-start
data collection, a first Phase 2 passive-collection slice, and Phase 3A
infrastructure:

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 112 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet, writing samples, edit events/metrics/profile,
  storage policy, `.hdna` manifest shape.
- Phase 1 onboarding: real writing samples -> deterministic T0 stylometry ->
  Expression Sheet compilation, synchronous (see `docs/decisions/0004`).
- Phase 2 (first slice): AI-output/human-edit pairs, captured manually in the
  popup, processed asynchronously through the job queue (P1) -> T0 diff
  metrics -> T1 incremental profile (see `docs/decisions/0005`).
- Phase 3A: dispatch is mode-gated (INTERACTIVE/BACKGROUND/DEEP_IDLE actually
  restrict which job priorities run), foreground activity is real (popup-open
  detection via `chrome.runtime.Port`), and storage eviction (CACHE→DERIVED→RAW,
  CANONICAL never automatic) actually runs (see `docs/decisions/0008`).

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

## Known gaps (intentionally deferred, not bugs)

- No live/passive capture — evidence only arrives via explicit user action
  (onboarding samples, manual edit-event form). Content-script-based live
  capture across web pages is `PLANNED`, pending a separate operator decision
  on `host_permissions` scope and privacy review (`docs/decisions/0005`).
- No character n-grams, typo-pattern detection, response-latency, or
  keystroke/session telemetry yet (Phase 2 T0 items not yet built).
- No tiny local classifiers (formality/directness/warmth/etc., Phase 2 T2) —
  explicitly deferred per the doc's MVP scope rule.
- EditProfile is not yet wired into the Expression Sheet — that integration
  belongs to the Phase 3/4 persona compiler, not this slice.
- No embeddings, vector index, persona compiler, WebGPU model.
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

None open. Eight operator decisions to date are recorded in `docs/decisions/`.
One decision (`0005`) is a scope boundary awaiting a future explicit operator
call: whether/how to add content-script-based live capture. Phase 3 is now
sequenced as 3A (this PR, done) / 3B (embeddings + vector index: one model
decision + benchmark + retrieval primitives) / 3C (tiny classifiers) — 3B and
3C are `PLANNED`, not started.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
