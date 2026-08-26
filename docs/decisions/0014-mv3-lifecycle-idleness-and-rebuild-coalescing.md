# 0014 — Fix: `idleTicks` does not survive MV3 service-worker termination; rebuild jobs made coalescable singletons

## Decision

Two independent fixes, found from the same round of manual testing on the
unpacked Chrome extension, on the same branch as 0013 (which they correct
and extend, not replace conceptually).

**1. Wall-clock-persisted idleness, not an in-memory tick counter.**
`RuntimeMode` selection still depends only on `foregroundActive` and how
long the foreground has been continuously inactive (0013's fix to *what*
DEEP_IDLE depends on stands) — but *how* that duration is tracked changed
completely. `idleTicks` (an in-memory integer, reset to 0 on every
`decide()` call chain restart) is gone. In its place:

- `RuntimeStatus.foregroundInactiveSince` (`extension/src/runtime/status.ts`)
  — an ISO timestamp, persisted through the existing `RuntimeStatusStore` /
  `IndexedDbStorageAdapter`, set once when foreground transitions to
  inactive and left alone until foreground reactivates.
- `computeForegroundInactivity()` (new file,
  `extension/src/runtime/foreground-inactivity.ts`) — a pure function
  `(previousInactiveSince, foregroundActive, nowMs) -> { foregroundInactiveSince, inactiveDurationMs }`.
  Duration is always `nowMs - Date.parse(foregroundInactiveSince)`, computed
  fresh every call from the persisted timestamp, never carried in memory.
- `decideMode(foregroundActive, inactiveDurationMs)`
  (`extension/src/governor/resource-governor.ts`) — exported separately
  from `decide()` so `entrypoints/background.ts` can compute *this* tick's
  mode, from persisted state, before dispatching any jobs (gating which
  priorities may run this tick), rather than only after `decide()`'s
  batch-size half runs post-dispatch.
- `entrypoints/background.ts` no longer keeps `mode` or `idleTicks` as
  `let` variables in the `defineBackground()` closure. Every dispatch tick:
  read `RuntimeStatusStore.get()` → `computeForegroundInactivity()` →
  `decideMode()` → dispatch → `decide()` for batch size only → persist the
  new `foregroundInactiveSince` back to `RuntimeStatusStore`. `batchSize`
  remains the one value still carried in service-worker memory (see Known
  limitations).

`DEEP_IDLE_AFTER_INACTIVE_MS = 90_000` replaces
`DEEP_IDLE_AFTER_IDLE_TICKS = 3`, same ~90s of real inactivity the old
tick-cadence math was aiming for, now expressed as an actual duration
instead of a tick count that assumed dispatch ticks always fire on a live
worker.

**2. `JobQueue.enqueueSingleton()` — generic rebuild-job coalescing.**
New method on `JobQueue` (`extension/src/queue/job-queue.ts`), alongside
the existing `enqueue()`: enqueues a job of `type` only if none is
currently `PENDING` or `RUNNING`; otherwise returns the existing
outstanding job, creating nothing new. `COMPLETE`/`FAILED` jobs don't
count as outstanding, so a trigger after completion (or failure) always
creates a fresh job normally. Keyed by `type` alone — generic, not tied to
any specific job. Applied uniformly to all three full-rebuild/recompile
job types identified during triage:
`enqueueT2ProfileRebuild`/`enqueueVectorIndexRebuild`/`enqueuePatternCompilation`
(`extension/src/queue/processors/trait-classification-jobs.ts`,
`embedding-jobs.ts`, `pattern-compilation-job.ts`) now call
`queue.enqueueSingleton(...)` instead of `queue.enqueue(...)`. The one
legitimately-per-item P2 job in the same files
(`enqueueEvidenceClassification`) is deliberately left on plain
`enqueue()` — it is correctly one job per evidence item, not duplicative.

## Why the decision was made

Manual retest of 0013's fix on the actual unpacked extension (not just the
pure-function test suite) found it insufficient in real Chrome:

- `background.ts` kept both `mode` and `idleTicks` only in service-worker
  memory, inside the `defineBackground(() => {...})` closure.
- MV3 service workers are suspended/terminated by Chrome between
  `chrome.alarms` ticks whenever nothing is actively keeping them alive.
  `ForegroundTracker.isActive` correctly resets to `false` on restart — a
  live `chrome.runtime.Port` (the popup connecting) is itself what keeps
  the worker alive, so by the time the worker is actually killed the
  foreground genuinely has disconnected. That part was never the bug.
- The bug was `idleTicks`: it reset to `0` on every restart right along
  with the rest of the closure. `DEEP_IDLE_AFTER_IDLE_TICKS = 3` required
  three *consecutive* ticks observed by the *same* in-memory counter. If
  the worker doesn't survive between alarms — the common case for a
  background/idle extension with no open popup — `idleTicks` can never
  advance past `1`, so `DEEP_IDLE` becomes structurally unreachable in real
  Chrome, even though `decide()`'s unit tests (which never modeled a
  restart) passed cleanly. Manually observed consequence: a
  `rebuild_t2_profile` `P3` job stayed pending indefinitely with the popup
  closed, reproducing 0013's original symptom despite 0013's fix being
  correctly implemented and tested at the pure-function level.
- Separately, the same manual session found repeated clicks on "Rebuild T2
  Profile" accumulated 82 pending `P3` jobs — `enqueue()` had no
  deduplication, so every click queued an independent, fully-duplicative
  rebuild.

The operator's fix directive was explicit on architecture: persist enough
to derive elapsed real time (`foregroundInactiveSince` or equivalent)
rather than patching the tick counter; keep governor decision logic
pure/deterministic; push persistence/lifecycle concerns to the runtime
boundary (`background.ts`); use existing storage/runtime primitives rather
than new infrastructure; treat the rebuild-duplication bug as a generic
queue-coalescing problem, not three button-specific hacks.

A second, self-identified correction beyond the operator's literal ask: a
duration fix to `computeForegroundInactivity()` alone would not have been
sufficient. `background.ts`'s in-memory `mode` variable — used to gate
*this* tick's dispatch based on the *previous* tick's decision — was
itself exactly as vulnerable to the same restart bug, independent of how
duration is tracked: even with correct duration math, a worker restart
would still gate dispatch on a stale reset-to-`BACKGROUND` default if mode
were computed the old way (post-dispatch, from an in-memory carry). Fixed
by exporting `decideMode()` separately from `decide()` so mode is
recomputed fresh, from persisted state, *before* dispatch, every tick —
eliminating the in-memory `mode` variable entirely, not just `idleTicks`.

## Alternatives considered

1. Keep `idleTicks` but persist the counter itself (instead of a
   timestamp) through `RuntimeStatusStore`, incrementing it on each tick.
   Rejected: still tick-cadence-relative rather than duration-based, so
   variability in real alarm firing (Chrome does not guarantee exact
   `periodInMinutes` timing, especially coming out of suspension) would
   make "3 ticks" an imprecise and untestable-as-a-duration proxy for "90s
   of inactivity." A persisted wall-clock timestamp is both more accurate
   and simpler to reason about and test.
2. Derive inactivity duration from `RuntimeStatus.updatedAt` (already
   persisted) instead of adding a new field. Rejected: `updatedAt` reflects
   the last dispatch tick's time, not the last time foreground was
   *active* — conflates "ticks haven't run" with "foreground has been
   inactive," which are different things (e.g. `processingPaused` or a
   fully-drained queue can both cause ticks to stop advancing `updatedAt`
   without foreground ever having been active in between).
3. Dedupe rebuild jobs by a content/param hash instead of by `type`.
   Rejected as unnecessary: all three rebuild job types take no meaningful
   payload (`{}`) — the job's identity *is* its type. A hash would add
   complexity with no behavioral difference for this use case; the
   docstring on `enqueueSingleton` calls out "keyed by type alone" as the
   generic contract, extensible to a payload-aware key later if a future
   job type needs one.
4. Reject/no-op a duplicate rebuild click instead of returning the existing
   job. Rejected: the UI (Rebuild button) needs *something* to reference
   (e.g. to show "rebuild in progress"); returning the outstanding job lets
   the caller treat a coalesced click identically to a fresh one without a
   special "already queued" branch.

## Research/evidence used

MV3 service-worker lifecycle behavior (workers may be terminated between
`chrome.alarms` events; a connected `chrome.runtime.Port` is a recognized
keep-alive signal) is standard, well-documented Chrome extension platform
behavior — not project-internal claims requiring external citation beyond
what's already implicit in the existing `ForegroundTracker` design this
fix builds on.

## What the AI system was asked to evaluate

The operator supplied the manual-test observations (P3 still starved with
popup closed; 82 duplicate pending jobs from repeated clicks), the
likely-failure-mode hypothesis (in-memory `idleTicks` reset by worker
restart), and precise architectural constraints (wall-clock/persisted
state; pure governor functions; lifecycle concerns at the runtime
boundary; generic coalescing, not job-specific hacks; specific lifecycle
regression-test scenario: inactive → wake → reconstruct from storage →
wake → reconstruct → time passes → P3 job runs and completes). The system
was asked to design and implement the persisted-timestamp mechanism
(including the `decideMode`/`decide` split, self-identified during
implementation), the `enqueueSingleton` mechanism, apply both fixes
without expanding scope beyond these two findings, and add regression
coverage strong enough to actually simulate the restart pattern rather
than only re-testing the pure decision functions in isolation.

## Known limitations

- `DEEP_IDLE_AFTER_INACTIVE_MS = 90_000` remains a placeholder tuning
  value, unchanged in spirit from 0013's `DEEP_IDLE_AFTER_IDLE_TICKS`
  choice — not derived from measurement.
- `batchSize` is still carried in `background.ts`'s in-memory closure, not
  persisted. Unlike `mode`/idleness, this is a self-correcting adaptation
  value (worst case: one tick runs with a stale batch size before
  `decide()`'s latency-ratio logic re-adjusts it), not a correctness bug —
  a restart resetting it to the safe default of `4` cannot cause starvation
  or incorrect mode/priority gating. Left as in-memory deliberately, to
  keep this fix scoped to the two reported findings rather than persisting
  every piece of runtime state on principle.
- `foregroundInactiveSince` is only updated inside the dispatch-alarm
  handler, same as before — if the queue is fully drained the handler's
  existing early-exit (pre-dating this fix) skips the rest of the tick
  body, including the status write. This can leave the persisted
  inactivity timestamp briefly stale in the transparency UI during
  genuinely idle-and-empty periods, inherited unchanged from 0013's same
  documented limitation; still not a starvation risk, since no job is
  pending during those skipped ticks by definition.
- `enqueueSingleton`'s outstanding-job check is a query-then-write, not an
  atomic compare-and-swap. Two concurrent callers within the same
  process/tick could theoretically both observe "no outstanding job" and
  each create one. Not a practical risk in the current architecture:
  `chrome.alarms` dispatch and UI-triggered enqueue calls run on a single
  JS event loop with no true parallelism, and `enqueueSingleton` await
  points don't yield to another `enqueueSingleton` call for the same type
  in this codebase's actual call patterns (button click handlers await
  sequentially). Documented rather than defended against, since adding
  locking would be exactly the "unnecessary infrastructure" the operator
  asked to avoid, for a race that doesn't occur here.

## Current validation status

Implemented and tested across `extension/src/runtime/status.ts`,
`extension/src/runtime/foreground-inactivity.ts` (new),
`extension/src/governor/types.ts`, `extension/src/governor/resource-governor.ts`,
`entrypoints/background.ts`, `extension/src/queue/job-queue.ts`, and the
three rebuild-enqueue call sites:

- `extension/tests/runtime/foreground-inactivity.test.ts` (new, 5 tests) —
  pure-function coverage of `computeForegroundInactivity()`, including that
  it is a pure function of its arguments with no cross-call state.
- `extension/tests/governor/resource-governor.test.ts` (rewritten) —
  `decide()`'s batch-size logic (unchanged, re-verified against the new
  2-argument signature); `decideMode()` wall-clock threshold behavior; a
  restart-simulating loop proving DEEP_IDLE is reached from independently
  computed per-tick durations with no in-memory carry between iterations.
- `extension/tests/runtime/mv3-lifecycle-p3-dispatch.test.ts` (new, 4
  tests) — integration-level coverage exercising the actual wiring (not
  just the pure functions): a `simulateWorkerRestartTick()` helper
  constructs a fresh `IndexedDbStorageAdapter`/`JobQueue`/
  `RuntimeStatusStore` on every simulated tick, sharing no in-memory state
  across calls, reconstructing mode and inactivity duration purely from
  what's in storage — mirroring a real service-worker restart between
  every dispatch alarm. Proves: (1) a lone pending `P3` job seeded via a
  throwaway queue instance eventually reaches `DEEP_IDLE` and *completes*
  after sustained simulated real time, confirmed by re-reading its status
  from a brand-new storage handle afterward; (2) `P0`–`P2` jobs still
  dispatch normally in `BACKGROUND` while a `P3` job waits untouched; (3)
  foreground reactivation immediately flips to `INTERACTIVE` even after
  accumulated DEEP_IDLE-eligible inactivity, and a subsequent inactivity
  period restarts its duration from `0`; (4) `P3` never runs across a full
  restart-every-tick simulation while foreground stays active.
- `extension/tests/queue/job-queue.test.ts` — 6 new tests for
  `enqueueSingleton()`: first call creates a job; 82 repeated calls (the
  exact reproduction of the manual-test count) collapse to one outstanding
  job; a `RUNNING` job also blocks a duplicate; `COMPLETE` and `FAILED`
  terminal states each unblock a fresh subsequent call; different job
  types don't interfere with each other's coalescing.
- `extension/tests/queue/trait-classification-jobs.test.ts`,
  `embedding-jobs.test.ts`, `pattern-compilation-job.test.ts` — one
  coalescing regression test added to each, covering all three named job
  types (`rebuild_t2_profile`, `rebuild_vector_index`, `compile_patterns`)
  through their actual `enqueue*` wrapper functions, confirming repeated
  calls stay at one outstanding job and a legitimate new rebuild is
  allowed after the prior one completes.
- 244/244 tests pass, clean `npx tsc --noEmit`, clean `npx wxt build`.
