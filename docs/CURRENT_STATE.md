# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

Phase 0 — HDNA Spec, Local Store, Runtime Contracts (MVP foundation only; see
`docs/architecture/mvp-scope.md`).

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, plus Phase 1 cold-start
data collection:

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 49 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet, writing samples, `.hdna` manifest shape.
- Phase 1 onboarding: real writing samples -> deterministic T0 stylometry ->
  Expression Sheet compilation, synchronous (see `docs/decisions/0004`).

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
- Popup UI: onboarding textarea + Expression Sheet summary, wired to live
  queue/storage/controls state, polls every 2s.
- `chrome.alarms`-driven background dispatch loop running the `noop` processor.

## Known gaps (intentionally deferred, not bugs)

- Onboarding is the only evidence source — no passive/background capture yet
  (Phase 2: keystroke telemetry, AI-edit diffing, character n-grams at scale).
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

None open. The four operator decisions to date are recorded in
`docs/decisions/`.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
