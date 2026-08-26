# 0002 — Single foundation PR instead of five incremental PRs

## Decision

Deliver the entire MVP foundation (spec types, storage, queue, governor,
controls, transparency UI, docs) as one branch/PR, rather than the doc's
default "every feature/fix through a dedicated PR" applied at fine grain.

## Why the decision was made

The repository had zero commits and no prior review history at the start of
this work. The pieces are tightly interdependent (queue depends on storage,
governor decisions are consumed by the background dispatch loop, UI reads all
three) and were being authored by a single agent in one sitting; splitting
into five sequential PRs would have meant several PRs with no independent
reviewable value in isolation (e.g. a queue with no dispatch loop to run it)
until the final piece landed.

## Alternatives considered

Five sequential PRs (scaffold; storage; queue; governor; UI+controls+docs) —
this was the default proposed to the operator, matching the doc's PR-per-
feature rule most literally. Rejected by the operator as unnecessary overhead
for a from-scratch scaffold with no existing reviewers/CI to protect.

## Research/evidence used

Not applicable — process decision, not a technical claim.

## What the AI system was asked to evaluate

Presented as an explicit choice to the operator before implementation: split
vs. single PR for the foundation bootstrap specifically. Operator chose single
PR.

## Scope of this decision

This is a one-time exception for the initial bootstrap. The doc's
"every feature and bug fix must be developed through a dedicated pull request"
rule applies as normal to all subsequent work (Phase 2 evidence capture,
governor refinements, UI additions, etc.).

## Current validation status

N/A (process decision). The resulting PR still satisfies the doc's other PR
requirements: dedicated branch (`feat/mvp-foundation`), scoped to the
foundation only, deterministic tests included and passing, decision trail
included.
