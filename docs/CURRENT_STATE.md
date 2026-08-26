# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

Phase 2 — Passive Evidence Collection (first slice: manual edit-event
capture; see `docs/architecture/mvp-scope.md`). Phase 0 (spec/runtime
contracts) and Phase 1 (cold-start onboarding) are complete.

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, Phase 1 cold-start
data collection, and a first Phase 2 passive-collection slice:

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 76 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet, writing samples, edit events/metrics/profile,
  `.hdna` manifest shape.
- Phase 1 onboarding: real writing samples -> deterministic T0 stylometry ->
  Expression Sheet compilation, synchronous (see `docs/decisions/0004`).
- Phase 2 (first slice): AI-output/human-edit pairs, captured manually in the
  popup, processed asynchronously through the job queue (P1) -> T0 diff
  metrics -> T1 incremental profile (see `docs/decisions/0005`).

## Implemented capabilities

- `IndexedDbStorageAdapter`: get/put/delete/query, per-storage-class byte usage.
- `JobQueue`: enqueue, priority+FIFO ordering, `runNext`, `countsByPriority`,
  persists through `StorageAdapter`.
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
- Popup UI: onboarding textarea + Expression Sheet summary + edit-capture form
  + Edit Profile summary, wired to live queue/storage/controls state, polls
  every 2s.
- `chrome.alarms`-driven background dispatch loop running the `noop` and
  `process_edit_event` processors.

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

None open. Six operator decisions to date are recorded in `docs/decisions/`.
One decision (`0005`) is a scope boundary awaiting a future explicit operator
call: whether/how to add content-script-based live capture.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
