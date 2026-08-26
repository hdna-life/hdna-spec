# 0007 — Job queue is at-least-once with stale-RUNNING reclaim; edit-event processor made idempotent; FIFO ordering fixed

## Decision

`JobQueue.next()` now reclaims any `RUNNING` job whose lease (`startedAt`) has
exceeded a timeout (default 5 minutes), flipping it back to `PENDING` so it
gets retried. This makes the queue at-least-once rather than "usually-once,"
and requires processors to tolerate re-running. The `process_edit_event`
processor was made idempotent to match: a `profileAppliedAt` receipt on
`EditMetrics` records whether an event's effect on `EditProfile` already
landed, and the metrics write + profile write happen in one atomic
`StorageAdapter.putMany()` call (new method, backed by a single
`IDBTransaction` — all records already live in one physical IndexedDB object
store, so this was a small addition) so a crash between "profile updated" and
"receipt persisted" can't happen.

While adding deterministic tests for the above, a second, pre-existing bug
surfaced: FIFO ordering within a priority class used `createdAt` string
comparison as its tiebreaker, but (a) `createdAt` is millisecond-resolution
and two `enqueue()` calls can collide, and (b) `IndexedDbStorageAdapter.query()`
doesn't guarantee insertion order for colliding index keys — ties resolved by
effectively-random UUID order instead of enqueue order. Fixed by adding an
explicit `Job.sequence: number`, a monotonic counter that is the actual FIFO
key (lazily resumed from persisted jobs' max sequence on first use, so
ordering stays correct across a service-worker restart too); `createdAt`
remains for telemetry only.

## Why the decision was made

Operator-identified defect: `JobQueue.next()` only ever considered `PENDING`
jobs. A job that reached `RUNNING` (persisted) and was then interrupted by
the MV3 service worker being killed mid-execution — a normal, expected event
for MV3, not a rare edge case — stayed `RUNNING` in IndexedDB forever. This
directly contradicted the code's own stated purpose ("queued work survives
MV3 service-worker termination"): PENDING work survived, but in-flight work
did not.

A naive fix (reclaim stale `RUNNING` jobs, retry them) is not sufficient by
itself — it turns "lost work" into "work that might run twice," which is
only safe if the processor is idempotent. The operator specifically pointed
out that the `process_edit_event` processor's original two-step write
(`metricsStore.put()` then `profileStore.applyIncrement()`) would double-count
`EditProfile`'s running means if replayed, and suggested exactly the fix
implemented: use the already-existing per-event `EditMetrics` record as the
idempotency receipt (a `profileAppliedAt`-style flag) rather than maintaining
a separate, ever-growing list of processed event ids.

Implementing that receipt with two independent `put()` calls would still
leave a race: a crash between "profile written" and "receipt written" would
cause a retried job to see no receipt and re-apply, double-counting anyway.
Since the storage layer already keeps every record in a single physical
IndexedDB object store, adding a genuinely atomic multi-key write
(`putMany()`, one `IDBTransaction`) closed that window at low cost rather
than accepting a smaller-but-nonzero residual race.

## Alternatives considered

1. Keep the queue "usually-once" (no reclaim) — rejected: this is the bug
   being fixed; PENDING-only recovery doesn't meet the queue's own documented
   guarantee.
2. Reclaim RUNNING jobs but leave the processor non-idempotent — rejected:
   converts silent work-loss into silent double-counting, which is worse for
   a system whose entire point is measuring the user accurately.
3. Idempotency via a separate "processed event ids" list — explicitly
   rejected by the operator: doesn't scale, and is redundant with data
   (`EditMetrics`) the system already persists per event.
4. Idempotency via a receipt flag with two sequential (non-atomic) writes —
   rejected: closes most of the window but not all of it; the atomic
   `putMany()` alternative was roughly the same implementation effort given
   the existing single-object-store storage design.
5. Cap retries / mark permanently `FAILED` after N stale-reclaims — considered
   but not implemented: not requested, and would reintroduce a different
   "stuck forever" failure mode (a systematically SW-killing job would end up
   permanently `FAILED` instead of `RUNNING` forever). Left as a known,
   unaddressed edge case — see Known limitations below.

## Research/evidence used

Not applicable — this is a correctness fix for the extension's own runtime
guarantees under Chrome's documented MV3 service-worker lifecycle, not a
claim requiring literature support.

## What the AI system was asked to evaluate

The operator described the failure scenario, its root cause (`next()` only
considers `PENDING`), and the general shape of the fix (lease timeout +
idempotent processor via a per-event receipt, not a growing id list) in
detail, and asked for the fix to be implemented. Evaluated for the specific
implementation: how to close the write-ordering race the receipt-flag
approach leaves open (the atomic `putMany()` addition), and how to test both
the reclaim mechanism and the idempotency guarantee deterministically
(injectable clock, directly seeded "stuck" job state, pre-seeded receipt
state, and a real atomicity test that forces a mid-transaction failure).

## Known limitations

- No retry cap: a job that deterministically kills the service worker every
  time it runs (e.g. a processor bug that crashes the runtime) would be
  reclaimed and retried indefinitely rather than eventually being marked
  `FAILED`. Not implemented because it wasn't requested and trades one
  stuck-forever failure mode for another; worth a future decision if it
  becomes a real problem.
- `putMany()`'s atomicity guarantee is specific to the current
  `IndexedDbStorageAdapter` implementation detail that all records share one
  physical object store. A future SQLite/OPFS-backed adapter (see
  `docs/decisions/0001`) would need to provide the same atomicity guarantee
  through its own transaction mechanism to preserve this correctness property
  behind the same `StorageAdapter` interface.

## Current validation status

Implemented and tested:
- `extension/src/queue/job-queue.ts`: `reclaimStaleJobs()`, `startedAt`
  lease, injectable clock, `sequence`-based FIFO ordering — 8 new/updated
  tests in `extension/tests/queue/job-queue.test.ts` (lease-window boundary,
  reclaim + retry to completion, count visibility before/after reclaim,
  colliding-timestamp FIFO regression, sequence resumption across a new
  instance sharing storage).
- `extension/src/storage/indexeddb-adapter.ts`: `putMany()` — 3 new tests in
  `extension/tests/storage/indexeddb-adapter.test.ts`, including a genuine
  all-or-nothing test that forces a mid-transaction clone failure and asserts
  the otherwise-valid entry did not land either (this test caught a real bug
  in the first implementation: a synchronous `DataCloneError` from `put()`
  does not auto-abort an IndexedDB transaction — fixed by explicitly calling
  `tx.abort()`).
- `extension/src/queue/processors/edit-event-processor.ts`: receipt check +
  atomic dual-write — 2 new tests in
  `extension/tests/queue/edit-event-processor.test.ts` (duplicate-job
  double-run does not double-count; pre-seeded receipt is honored as a
  no-op).
- 86/86 tests pass, clean typecheck, clean build.
