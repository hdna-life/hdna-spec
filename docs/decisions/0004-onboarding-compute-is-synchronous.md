# 0004 — Onboarding Expression Sheet compile runs synchronously, not through the job queue

## Decision

When a user adds a writing sample during Phase 1 cold-start onboarding, the
Expression Sheet is recompiled synchronously in the popup (direct function
call, immediate persistence), rather than going through the `JobQueue`/
`chrome.alarms` background dispatch pipeline built in the MVP foundation PR.

## Why the decision was made

The design doc separates two distinct data-collection phases:

- **Phase 1 — Cold-start Persona**: a small, explicit, user-initiated set of
  writing samples during onboarding. Low volume, user is actively waiting for
  feedback.
- **Phase 2 — Passive Evidence Collection**: high-volume, ambient background
  capture (keystrokes, AI-edit diffs, etc.) that must never block foreground
  interaction — this is what the job queue, priority classes, and resource
  governor exist for ("HDNA learning is asynchronous, incremental,
  opportunistic, and self-throttling").

Recompiling from a handful of short pasted samples is a cheap, deterministic,
sub-millisecond operation (confirmed by the stylometry test suite — no test
sample set takes measurably long). Routing it through the queue would add
latency (the background dispatch alarm fires every 30s) and indirection for
no benefit, and would blur the doc's own Phase 1 vs. Phase 2 distinction.

## Alternatives considered

Enqueue a `P1` job on every `addSample` call and let the background dispatch
loop recompile — rejected: this is the Phase 2 passive-collection pattern
applied to a Phase 2-inappropriate, user-facing, low-volume interaction. It
would also make the onboarding UI feel unresponsive (up to 30s before the
Expression Sheet summary updates) for no architectural benefit.

## Research/evidence used

Not applicable — direct application of the design doc's own phase separation
(Phase 1 cold-start vs. Phase 2 passive collection), not an external claim.

## What the AI system was asked to evaluate

Whether writing-sample ingestion should reuse the job-queue infrastructure
built in the foundation PR or bypass it. Evaluated against the doc's explicit
phase boundaries; recommending synchronous compute for Phase 1 only.

## Current validation status

Implemented: `extension/entrypoints/popup/App.svelte`'s `addSample` handler
calls `WritingSampleStore.addSample` then `ExpressionSheetStore.recompile`
directly. Phase 2's actual passive-telemetry job types (character n-grams,
AI-edit diffing, etc.) remain unimplemented and, when built, should go through
the job queue as originally designed — this decision does not change that.
