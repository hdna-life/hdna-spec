# HDNA Current State

Read this first. It describes the CURRENT product/architecture reality —
not a chronological narrative of how the project got here. History lives
in `docs/history/` and `docs/decisions/`'s ADRs; this file should never
need those to be understood.

## What is HDNA?

A local, portable behavioral layer for AI. Frontier models provide
intelligence; HDNA learns how a user naturally communicates and adapts
frontier output's expression to match, without training or fine-tuning
the frontier model itself and without sending raw personal text off the
user's device by default. Full product contract:
`docs/MVP_PRODUCT_CONTRACT.md`.

**This is not personality inference or mind-reading.** HDNA reasons about
directly observable textual behavior only — never a claim about the
user's psychology, motivation, emotional state, or identity.

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

## Two things not to confuse

**VALIDATED RESEARCH PRIMITIVE** — localized BEFORE/AFTER semantic +
behavioral judgment (`SemanticRevisionJudgeProvider`, the v3 two-axis
contract). Given one AI-draft/human-edit pair, judges the semantic
`verdict` plus observable-behavior `dimensions` of that one localized
change. This is what Test 1 validated as trainable on a tiny local model.
It is not the product's primary learning mechanism — its future role is
contributing to the `<VERIFY>` safety gate (see
`docs/MVP_PRODUCT_CONTRACT.md`).

**FINAL MVP LEARNING DIRECTION** — a single natural user-authored text
(no AI draft, no edit pair) → local `<LEARN>` → structured style/
preference observations → deterministic confidence/recency aggregation →
user-owned `.hdna` state. This is the actual product learning mechanism.
**Not validated by Test 1.** Full contract, boundaries, and privacy
rules: `docs/MVP_PRODUCT_CONTRACT.md`.

Do not read the existing `EditEvent`/`EditProfile`/`SemanticDeltaCandidate`
research pipeline (AI-output → human-edit comparison) as the product's
learning source — it answered a narrower research question and is being
superseded by the direction above.

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
- **183-example LoRA baseline** — the frozen training corpus is committed
  (`training/phase5a/dataset/frozen/trial4-v3-human-183.json` + manifest).
  Adapter weights themselves are a local/generated artifact
  (`training/phase5a/adapters/v1/`, gitignored — not committed); not being
  expanded further.
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

**Test 2 — the final pre-product research test.** Narrow question: can
`google/gemma-3-270m-it`, after clean synthetic filtered distillation,
retain acceptable quality on the canonical v3 judgment primitive AND run
as the intended browser/WebGPU-class model? Test 2 does **not** claim to
validate the complete LEARN/REWRITE product loop — that loop is product
work, implemented immediately after Test 2 passes, using normal product
acceptance tests rather than another broad research phase.

- Pipeline: `policy/coverage spec -> frontier synthetic generation ->
  independent frontier verification/filtering -> schema+taxonomy
  validation -> dedup -> coverage balancing -> frozen synthetic corpus ->
  LoRA/SFT -> fresh held-out benchmark -> failure analysis -> targeted
  next iteration`. Skeleton: `training/test2/`.
- Target: ~5,000 accepted examples, targeted at difficult taxonomy
  boundaries rather than scaling random examples.
- Must include a real browser/WebGPU deployment smoke test of the
  quantized artifact — a training run alone does not validate the WebGPU
  target.
- A completely new held-out evaluation — Test 1's benchmark cases must
  not be reused as Test 2's scored benchmark.

**If Test 2 passes:** implement the LEARN/REWRITE/VERIFY product loop per
`docs/MVP_PRODUCT_CONTRACT.md`.

Full detail: `training/phase5a/benchmark/test1-final-result.md`'s "Direct
transition to Test 2" section, `docs/decisions/0017`, `training/test2/README.md`.

## Where to look

- Module-level source layout: `spec/` (protocol/schema types, no runtime
  logic), `extension/src/` (runtime), `extension/entrypoints/` (MV3
  background + Dashboard/popup), `training/phase5a/` (Python
  training/benchmark pipeline). Read the source tree directly rather than
  a manually maintained file listing — it will always be more current.
- Final MVP product contract (post-Test-2 direction): `docs/MVP_PRODUCT_CONTRACT.md`.
- MVP scope classification (what's implemented vs. planned vs.
  experimental): `docs/architecture/mvp-scope.md`.
- Canonical edit-judgment contract:
  `training/phase5a/lore/task-contract.v3.md` (+
  `policy-spec.v1.json`).
- Decision log (concise, current architectural decisions):
  `docs/decisions/`.
- Historical experiment narratives, superseded trial-by-trial results,
  and old manual-testing chronology: `docs/history/`.
