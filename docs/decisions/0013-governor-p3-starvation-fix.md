# 0013 — Fix: DEEP_IDLE mode selection made P3 jobs self-blocking (governor starvation bug)

## Decision

`RuntimeMode` selection no longer depends on `queueBacklog`. It now depends
only on `foregroundActive` and a new `idleTicks` counter — consecutive
dispatch ticks with the foreground inactive, threaded through `decide()`
the same way `previousBatchSize` already is (pure function, state carried
by the caller). `DEEP_IDLE` is selected once `idleTicks` reaches a
sustained-idleness threshold (`DEEP_IDLE_AFTER_IDLE_TICKS = 3`); otherwise
`BACKGROUND`. `queueBacklog` remains in `GovernorSignals` (still a real,
useful signal per the design doc's governor-signals list) but is no longer
read by `decideMode()`.

## Why the decision was made

Operator-found bug via manual testing: a `rebuild_t2_profile` `P3` job
stayed `PENDING` forever, even with the popup closed. Root cause, traced in
the existing code:

- `ALLOWED_PRIORITIES_BY_MODE`: `BACKGROUND` allows only `P0`–`P2`; `P3`
  requires `DEEP_IDLE`.
- `decideMode()` (pre-fix): `DEEP_IDLE` was selected only when
  `queueBacklog === 0`; any backlog ≥ 1 selected `BACKGROUND`.

A pending `P3` job is itself part of `queueBacklog`. So: `P3` job pending →
`queueBacklog ≥ 1` → mode forced to `BACKGROUND` → `BACKGROUND` can't
dispatch `P3` → the job stays pending → `queueBacklog` stays ≥ 1 forever.
The job's own existence in the queue permanently disqualified the only mode
that could run it — a deterministic livelock, not a timing fluke, and not
specific to `rebuild_t2_profile`: any `P3` job pending with no other `P3`
work to drain it alongside would starve identically, and even a *mix* of
`P3` jobs never converges, since `BACKGROUND` only ever drains `P0`–`P2`,
never reducing the `P3` portion of the backlog.

The operator's framing was explicit: `DEEP_IDLE` is supposed to represent
actual foreground/system idleness (per the design doc's runtime-modes
section — "cache maintenance," "persona compilation," "derived artifact
rebuilds" are DEEP_IDLE-class work meant to run when the system is
genuinely idle), not "the queue happens to be empty." Using queue-emptiness
as the DEEP_IDLE gate conflated two unrelated things: how idle the *user*
is, and how much *work* is queued — and made the second one able to block
itself.

## Alternatives considered

1. Special-case `rebuild_t2_profile` (e.g. let it also run in `BACKGROUND`)
   — explicitly rejected by the operator: fixes one job, not the scheduling
   semantics; every future `P3` job would carry the same latent bug.
2. Keep backlog-based `DEEP_IDLE` gating but exclude the mode's own
   allowed-priority jobs from the backlog count used for the gate (i.e.
   "empty of anything DEEP_IDLE doesn't already permit") — considered, but
   this just re-derives "foreground inactive," expressed awkwardly through
   queue arithmetic, for no benefit over tracking idleness directly. It
   would also still misrepresent DEEP_IDLE's meaning (idle *system*, not
   idle *queue*).
3. Let `BACKGROUND` also dispatch `P3` — rejected: collapses the priority
   ladder the doc defines (`P3` is explicitly "expensive/rare," reserved for
   genuine idle time) and defeats the purpose of having a `DEEP_IDLE` tier
   at all.
4. Time-based idleness (wall-clock duration since foreground went inactive,
   via an injectable clock) instead of a tick counter — considered; a tick
   counter was chosen as the smaller change, consistent with how
   `batchSize` is already threaded as a plain counter across calls without
   timestamps, and avoids adding clock-injection machinery to a function
   that didn't need it before. Documented as tick-cadence-relative, not a
   precise duration guarantee.

## Research/evidence used

Not applicable — this is a scheduling-logic bug fix internal to the
project's own governor design, not a claim requiring external evidence.

## What the AI system was asked to evaluate

The operator provided the full root-cause trace already (which fields,
which functions, why the cycle never breaks) and specified the fix's
constraints precisely: fix the scheduling semantics, not the specific job;
`DEEP_IDLE` must mean actual idleness, not empty queue; preserve
foreground-first behavior and the `P0`–`P3` priority semantics; add a
regression test proving a lone `P3` job eventually runs after the
foreground goes inactive, plus tests proving `P3` still doesn't run while
`INTERACTIVE`. The system's task was to design the idleness-tracking
mechanism itself (tick counter vs. wall-clock, where the state lives, how
it threads through the existing pure-function `decide()` pattern without
compromising it) and implement/verify the fix and tests accordingly.

## Known limitations

- `DEEP_IDLE_AFTER_IDLE_TICKS = 3` is a placeholder tuning value (roughly
  90s of sustained inactivity at the current ~30s dispatch cadence), not
  derived from measurement — consistent with other placeholder constants
  already documented elsewhere in this codebase (e.g. the 50MB eviction
  budget in `docs/decisions/0008`).
- Idle-tick counting only advances on ticks where the dispatch alarm
  handler actually runs `decide()`; if `queueBacklog` is genuinely `0` the
  handler returns before reaching the governor at all (a separate,
  pre-existing early-exit, unrelated to this bug). This doesn't reintroduce
  starvation — that early exit only fires when there is no pending work of
  any kind, so no job is ever waiting during the ticks it skips — but it
  does mean `RuntimeStatus.mode` can go briefly stale in the transparency
  UI during genuinely idle-and-empty periods. Not addressed here; out of
  scope for a starvation fix.

## Current validation status

Implemented and tested in `extension/src/governor/resource-governor.ts`,
`extension/src/governor/types.ts`, `entrypoints/background.ts`, and
`extension/tests/governor/resource-governor.test.ts`:
- Existing batch-size tests updated for `decide()`'s new
  `previousIdleTicks` parameter — all still pass, confirming latency-ratio
  batch-size logic is unchanged.
- 3 new tests confirming mode transitions are driven purely by foreground
  idleness (immediate post-idle tick stays `BACKGROUND`; sustained idle
  ticks reach `DEEP_IDLE` even with nonzero backlog; foreground reactivation
  resets `idleTicks` to `0` and snaps back to `INTERACTIVE` instantly).
- 3 new regression tests reproducing the reported bug directly: a `P3` job
  with `queueBacklog` pinned at `1` across every tick (simulating a job
  nothing else can dispatch) eventually reaches `DEEP_IDLE`; `P3` still
  never runs while `INTERACTIVE` regardless of how long it's been pending;
  `ALLOWED_PRIORITIES_BY_MODE` confirms `P3` is excluded from both
  `INTERACTIVE` and `BACKGROUND`.
- 223/223 tests pass (12 new/updated in the governor suite), clean
  typecheck, clean build.
