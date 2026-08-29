# HDNA Current State

Read this first. It describes the CURRENT product/architecture reality —
not a chronological narrative of how the project got here. History lives
in `docs/history/` and `docs/decisions/`'s ADRs; this file should never
need those to be understood.

## What is HDNA?

HDNA observes how a user actually edits AI-generated text — what they
add, remove, and rephrase — and builds a local, user-owned model of that
editing behavior. The goal is a lightweight local layer that can later
transform/steer frontier-model output to better match how a specific user
actually writes and edits, without ever training or fine-tuning the
frontier model itself, and without sending raw behavioral evidence off
the user's device by default.

**This is not personality inference or mind-reading.** HDNA only reasons
about directly observable textual behavior in one localized edit at a
time — never a claim about the user's psychology, motivation, emotional
state, or identity. See §"Current canonical runtime principles" below.

## Product status

- **Phase 5A Trial 4 / Test 1: CLOSED — SUCCESS.** Trainability of a very
  small local edit judge is validated: a `Qwen/Qwen3-0.6B` LoRA
  specialized on 183 human-reviewed examples reached 80% semantic-exact
  accuracy and 80% human-acceptable rate on a fresh 10-case held-out
  validation. Full result:
  `training/phase5a/benchmark/test1-final-result.md`.
- **Test 2 is next:** automated synthetic distillation (~5,000 accepted
  examples, frontier-generated + independently filtered) targeting a
  smaller WebGPU-oriented student, `google/gemma-3-270m-it`. Not started —
  see "Next" below.
- The MV3 extension runtime (storage, job queue, governor, deterministic
  Phase 1-4 evidence pipeline, T3 OpenRouter persona interpretation, Phase
  5A semantic-delta extraction, and the Trial 4 benchmark Dashboard) is
  implemented and tested. See `docs/architecture/mvp-scope.md` for the
  MVP_REQUIRED/PLANNED/EXPERIMENTAL scope breakdown.

## MVP product direction

```
AI output
  -> user edits
  -> deterministic localized revision extraction
  -> local behavioral/edit judgment
  -> structured observable behavior evidence
  -> aggregation into a user-specific behavioral representation
  -> (later) a lightweight local transformation/behavior layer
     around frontier-model output
```

Each arrow above corresponds to a real, implemented or validated piece of
this codebase:

- **Deterministic localized revision extraction** — `revision-diff.ts` /
  `revision-intervention.ts` (word/token-level diff, localizes exactly
  what changed, never delegated to a model).
- **Local behavioral/edit judgment** — the `SemanticRevisionJudgeProvider`
  contract, currently a local MLX-served small model plus a frontier
  reference via OpenRouter; Test 1 validated this judgment is learnable
  by specialization on a sub-billion-parameter local model.
- **Structured observable behavior evidence** — the v3 two-axis output:
  a semantic `verdict` plus zero or more `{dimension, direction}`
  observable-behavior pairs. Canonical contract:
  `training/phase5a/lore/task-contract.v3.md`.
- **Aggregation into a user-specific behavioral representation** — the
  existing `EditProfile`/`T2Profile`/`Pattern`/`TraitBeliefClaim`
  deterministic-then-interpreted evidence hierarchy (see "Implemented
  capabilities" in `docs/architecture/mvp-scope.md`); not yet wired to
  the new v3 judgment output specifically — future work.
- **A local transformation/behavior layer around frontier output** — not
  yet built. This is the eventual target Test 1/Test 2 exist to validate
  the feasibility of, not a current capability.

## Current canonical runtime principles

- **Local-first / user-owned behavioral data.** Evidence is stored on the
  user's device (`IndexedDbStorageAdapter`) by default; nothing leaves
  the device without an explicit, disclosed, opt-in network boundary.
- **Deterministic preprocessing where possible.** Localization, diffing,
  admission, and storage classification are deterministic HDNA logic —
  models are given the narrowest possible judgment, never asked to
  discover boundaries or aggregate across evidence themselves.
- **Local small-model judgment.** The edit-judgment step targets a
  sub-billion-parameter model runnable locally (currently MLX/Apple
  Silicon for Test 1; WebGPU is the target runtime — see "Next").
- **Browser/WebGPU target.** The eventual runtime for both judgment and
  any transformation layer is the browser, not a server.
- **Observable textual behavior, not hidden psychology.** The judgment
  contract (`task-contract.v3.md`) explicitly forbids inferring emotion,
  motivation, psychology, identity, or personality from one observation —
  only directly observable expressed wording.
- **Explicit export/network boundaries.** Every network-calling component
  (T3's `OpenRouterPersonaInterpreter`, Phase 5A's semantic-delta
  extractor, Trial 4's benchmark providers) is opt-in, behind its own
  config store, and documented with exactly what leaves the device.
- **Rebuildable derived state.** Every derived store (embeddings, T2
  profile, patterns, trait/belief claims) is fully reconstructable from
  canonical evidence — nothing derived is itself a second source of
  truth.

## Validated

- **Test 1 (`Qwen3-0.6B` specialization feasibility): SUCCESS.** A LoRA
  adapter trained on 183 human-reviewed v3 examples materially
  outperformed the same base model zero-shot (Trial 3's frozen baseline:
  52.9% semantic / 51% A-B discrimination / 14.9% coarse-feature).
- **183-example LoRA baseline** — preserved for provenance
  (`training/phase5a/adapters/v1/`), not being expanded further.
- **Final fresh 10-case Turkish held-out validation:** 80% semantic-exact
  accuracy, 80% human-acceptable rate, vs. DeepSeek (frontier reference)
  78% / 100%. Do not read this as "beat DeepSeek" — DeepSeek remained
  clearly superior in dimension quality and blind ranking (89% Rank-1 vs.
  10%).
- **Dimensions remain the main weakness** — false-positive dimensions,
  missed dimensions, and boundary confusion between related dimensions
  were common; the semantic verdict axis was learned far better than the
  full 15-dimension behavioral taxonomy.
- **Test 1 was feasibility/trainability validation, not production
  certification** — it did not establish production-ready judgment
  quality, reliable dimension prediction, frontier-level output quality,
  or that `Qwen3-0.6B` should be the production student. See
  `training/phase5a/benchmark/test1-final-result.md`'s "What Test 1 did
  NOT prove" section.
- Deterministic pipeline execution (canonical evidence -> derived metrics
  -> patterns -> minimized aggregates -> LLM interpretation -> persisted
  claims) is confirmed working end to end against real data and a real
  external API (T3/OpenRouter dogfood run) — see
  `docs/decisions/0015`.

## Next

- **Test 2: automated synthetic filtered distillation.** Replaces manual
  hundreds-of-examples review with:
  `policy/coverage spec -> frontier synthetic generation -> independent
  frontier verification/filtering -> schema+taxonomy validation ->
  dedup -> coverage balancing -> frozen synthetic corpus -> LoRA/SFT ->
  fresh held-out benchmark -> failure analysis -> targeted next iteration`.
- **Target: ~5,000 accepted training examples**, deliberately targeted at
  difficult taxonomy boundaries (e.g. `meaning_added` vs
  `meaning_transformed`, `scope` vs `specificity`, `certainty` vs
  `evidentiality`/`commitment`, observable expressed affect vs inferred
  internal emotion) rather than scaling random examples.
- **Planned student: `google/gemma-3-270m-it`** — smaller,
  WebGPU-oriented, targeting lightweight quantized browser deployment.
  Not yet implemented; this is a recorded direction, not a completed
  migration.
- **A completely new held-out evaluation** — Test 1's benchmark cases must
  not be reused as Test 2's scored benchmark (they have already been
  inspected).

Full detail: `training/phase5a/benchmark/test1-final-result.md`'s "Direct
transition to Test 2" section, `docs/decisions/0017`.

## Where to look

- Module-level source layout: `spec/` (protocol/schema types, no runtime
  logic), `extension/src/` (runtime), `extension/entrypoints/` (MV3
  background + Dashboard/popup), `training/phase5a/` (Python
  training/benchmark pipeline). Read the source tree directly rather than
  a manually maintained file listing — it will always be more current.
- MVP scope classification (what's implemented vs. planned vs.
  experimental): `docs/architecture/mvp-scope.md`.
- Canonical edit-judgment contract:
  `training/phase5a/lore/task-contract.v3.md` (+
  `policy-spec.v1.json`).
- Decision log (concise, current architectural decisions):
  `docs/decisions/`.
- Historical experiment narratives, superseded trial-by-trial results,
  and old manual-testing chronology: `docs/history/`.
