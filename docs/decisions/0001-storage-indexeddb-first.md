# 0001 — Storage: IndexedDB first, SQLite WASM + OPFS deferred

## Decision

Build the MVP foundation's local storage abstraction (`StorageAdapter`) against
IndexedDB, not SQLite WASM + OPFS as literally specified in
`hdna-design-research-document.md`'s Phase 0 core runtime stack.

## Why the decision was made

MV3 service workers can be terminated by Chrome at any time. OPFS
`createSyncAccessHandle` handles do not reliably survive that termination
without a dedicated worker or offscreen document owning the handle and
relaying reads/writes to the service worker — a mitigation the source document
does not mention. Building the very first storage layer directly against
SQLite+OPFS in the service worker risks handle loss/corruption mid-write; doing
it correctly (offscreen document + message relay) is real scaffolding
complexity that isn't justified before any relational/evidence-graph query need
exists.

IndexedDB is natively usable from an MV3 service worker with no such lifecycle
hazard, and is trivially unit-testable via `fake-indexeddb` without a browser.

## Alternatives considered

1. SQLite WASM + OPFS directly in the service worker — rejected: highest risk
   of the three, no lifecycle mitigation.
2. SQLite WASM + OPFS via an offscreen document — viable, but adds an entire
   additional extension context (offscreen document + message-passing
   protocol) to the very first PR, before any query pattern demands SQL over
   IndexedDB.
3. IndexedDB abstraction now, SQLite/OPFS later (chosen) — matches the doc's
   own storage-abstraction intent (`StorageAdapter` interface, storage
   classes) while deferring the harder implementation until it's justified by
   an actual relational-query requirement (e.g. the evidence graph in a later
   phase).

## Research/evidence used

None external; this is an engineering-risk judgment about Chrome MV3 service
worker lifecycle and current OPFS API constraints, not a claim requiring
literature support.

## What the AI system was asked to evaluate

Whether to implement the doc's literal Phase 0 stack (`SQLite WASM + OPFS`) as
written, or propose an alternative given the MV3 service worker + OPFS
interaction risk. Presented to the operator as a named decision point before
implementation began (see conversation record); operator selected the
IndexedDB-first option.

## Operator directive

This is **not** a rejection of SQLite/OPFS. The operator explicitly directed
that this decision be recorded as work deferred to a future phase/spec
revision, not discarded: "işi çöpe atmadık başka bir faz'a/spec'e erteledik."

`StorageAdapter` is the seam: a future SQLite/OPFS-backed adapter (behind an
offscreen document) can replace `IndexedDbStorageAdapter` without changing any
caller, once relational/evidence-graph query needs justify the added
complexity.

## Current validation status

Implemented and tested: `extension/src/storage/indexeddb-adapter.ts`,
`extension/tests/storage/indexeddb-adapter.test.ts` (6 deterministic tests —
round-trip, missing key, delete, scoped query, cross-instance persistence,
per-storage-class byte accounting).
