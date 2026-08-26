# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

Phase 0 — HDNA Spec, Local Store, Runtime Contracts (MVP foundation only; see
`docs/architecture/mvp-scope.md`).

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, not the hypothesis itself:

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 25 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet (schema only), `.hdna` manifest shape.

## Implemented capabilities

- `IndexedDbStorageAdapter`: get/put/delete/query, per-storage-class byte usage.
- `JobQueue`: enqueue, priority+FIFO ordering, `runNext`, `countsByPriority`,
  persists through `StorageAdapter`.
- `resource-governor.decide()`: pure function, INTERACTIVE/BACKGROUND/DEEP_IDLE
  mode selection, batch-size halving/doubling on latency ratio.
- `RuntimeControls`: persisted `processingPaused`/`learningPaused` state.
- Popup UI wired to live queue/storage/controls state, polls every 2s.
- `chrome.alarms`-driven background dispatch loop running the `noop` processor.

## Known gaps (intentionally deferred, not bugs)

- No real evidence capture — only a synthetic `noop` job proves the pipeline.
- No stylometry, embeddings, vector index, persona compiler, WebGPU model.
- Governor's WebGPU-contention/battery/memory-pressure signals are typed
  (`SPEC_RESERVED`) but unwired — nothing produces them yet.
- Expression Sheet fields are all unpopulated placeholders.
- `.hdna` manifest type exists; no compiler/export pipeline.
- SQLite WASM + OPFS (doc's original Phase 0 storage mandate) not implemented —
  see `docs/decisions/0001-storage-indexeddb-first.md`.

## Current experiments / pending decisions

None open. The three operator decisions for this PR are recorded in
`docs/decisions/`.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
