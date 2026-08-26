# 0008 — Phase 3A: mode-gated dispatch, foreground detection, and working storage eviction

## Decision

First Phase 3 slice, scoped to infrastructure only per operator direction —
no embeddings, vector index, or classifiers in this PR. Two things:

1. **Batching/scheduling made consequential.** The resource governor's
   `mode` output (`INTERACTIVE`/`BACKGROUND`/`DEEP_IDLE`) was computed every
   dispatch tick but never used — every job type ran regardless of mode.
   `JobQueue.next()`/`runNext()` now accept an optional `allowedPriorities`
   filter, and `background.ts` restricts dispatch to
   `ALLOWED_PRIORITIES_BY_MODE[mode]` (new module) each tick. `foregroundActive`
   was also always hardcoded `false` — replaced with a real signal via
   `ForegroundTracker`, which tracks whether the popup is currently open using
   a long-lived `chrome.runtime.Port` connection (the idiomatic MV3 pattern;
   no polling).
2. **Storage eviction actually runs.** `STORAGE_CLASS_DELETION_ORDER` existed
   since the foundation PR but nothing used it. Added `StorageAdapter.listRecordMeta()`
   (record identity + size, no value payload), a pure `planEviction()`
   function (CACHE → DERIVED → RAW, CANONICAL never automatic), and
   `evictIfNeeded()`, wired into the background dispatch loop — checked every
   tick, deletions only performed outside `INTERACTIVE` mode ("foreground
   interaction always wins").

Also: `Status.svelte` already had an unused `mode` prop that silently
defaulted to `'DEEP_IDLE'` since no caller ever passed a real value. Since
mode is now real, a small `RuntimeStatusStore` persists the background loop's
live `{ mode, batchSize, lastEvictionAt, lastEvictionBytesFreed }` (the popup
runs in a separate execution context and can't read background's in-memory
state directly) so the popup can display it — closing that existing gap
rather than leaving a second dead prop next to a newly-real one.

## Why the decision was made

Operator's explicit rationale: once embeddings land (Phase 3B), `DERIVED`
storage volume will grow materially for the first time. Getting "how do we
safely manage the derived artifacts we produce" working *before* producing
them at scale is cleaner than bolting it on after. Same logic for batching:
the mode/priority machinery needs to actually gate dispatch before there's
real GPU-touching P2/P3 work to gate, or the first embedding job would ship
into an ungated dispatch loop with no tested backpressure behavior.

Operator-specified sequencing, recorded for future reference:
- **3A (this PR)** — batching + resource scheduling + storage/eviction.
- **3B** — embeddings + vector index: one model decision + benchmark +
  retrieval primitives, its own PR.
- **3C** — tiny classifiers (formality/directness/warmth/etc.), its own PR.

## Alternatives considered

- Leave storage budget hardcoded with no eviction until embeddings land —
  rejected per the operator's explicit ordering rationale above.
- Gate dispatch by mode inside `JobQueue` itself (queue owns mode) — rejected:
  mode is a governor/runtime-loop concept, not a queue concept; keeping the
  queue as a plain (optionally-filtered) priority store and letting the
  caller decide which priorities to run keeps `JobQueue` reusable and
  simpler to test.
- Detect foreground activity by having the popup ping the background
  periodically — rejected in favor of `chrome.runtime.connect`/`onDisconnect`:
  no polling, no timer drift, and disconnect fires reliably when the popup
  closes.
- Per-storage-class eviction budgets, or LRU/recency-based ordering within a
  class — not implemented: the design doc specifies class-priority order
  (CACHE→DERIVED→RAW) but not a within-class policy or per-class budgets;
  a single total-byte budget with class-priority eviction is the smallest
  thing that satisfies the doc's stated policy. Noted as a documented
  simplification, not a gap requiring a decision.

## Research/evidence used

Not applicable — this implements the design doc's own stated runtime-mode and
storage-policy sections; no external claim is being made.

## What the AI system was asked to evaluate

Given the operator's stated rationale and PR ordering (3A/3B/3C), scoped and
implemented the "infrastructure only" slice: which specific gaps in the
existing (foundation PR) governor/storage code needed to be closed for
batching and eviction to be real rather than typed-but-inert, and how to
test each piece deterministically (a fake `chrome.runtime.Port` for the
foreground tracker, injectable clocks and priority filters for the queue,
byte-budget scenarios for eviction planning).

## Known limitations

- Eviction budget (`DEFAULT_STORAGE_POLICY.maxTotalBytes`, 50 MB) is a
  hardcoded placeholder, not user-configurable yet — the doc's "configure
  storage limits" user control remains future UI work.
- Within-class eviction order is whatever `listRecordMeta()` returns, not
  LRU/recency-based — see Alternatives above.
- `foregroundActive` currently only reflects "is the popup open." It doesn't
  yet account for other foreground signals the doc mentions (recent
  interaction latency, active tab focus) — those aren't sources this
  extension has wired up yet.

## Current validation status

Implemented and tested:
- `extension/src/storage/eviction.ts` (`planEviction`, `evictIfNeeded`) — 6
  tests in `extension/tests/storage/eviction.test.ts` (under-budget no-op,
  CACHE-before-DERIVED-before-RAW ordering, CANONICAL never evicted,
  stops-exactly-at-budget, and two tests against real `IndexedDbStorageAdapter`
  storage).
- `IndexedDbStorageAdapter.listRecordMeta()` — 3 tests in
  `extension/tests/storage/indexeddb-adapter.test.ts`.
- `extension/src/governor/mode-priorities.ts` — 5 tests asserting the
  INTERACTIVE ⊆ BACKGROUND ⊆ DEEP_IDLE widening relationship.
- `JobQueue.next()`/`runNext()` priority filter — 3 tests in
  `extension/tests/queue/job-queue.test.ts`.
- `ForegroundTracker` — 6 tests in
  `extension/tests/runtime/foreground-tracker.test.ts` (connect/disconnect,
  wrong port name ignored, multiple connections, double-disconnect safety).
- `RuntimeStatusStore` — 3 tests in `extension/tests/runtime/status.test.ts`.
- 112/112 tests pass, clean typecheck, clean build (84.1 KB total).
