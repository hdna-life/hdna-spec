# 0017 — Phase 5A Trial 4: human-filtered tiny-model specialization + blind benchmark

## Status

**Phase 5A Trial 4 / Test 1: CLOSED — SUCCESS.** This decision records
twelve explicit operator decisions (below) that governed how Trial 4 was
run — training/falsification separation, blind A/B/C evaluation, DeepSeek
as a reference not an oracle, and the rest — all of which remain the
durable methodology principles for Test 2. The trainability question
itself is answered: a `Qwen3-0.6B` LoRA specialized on 183 human-reviewed
examples reached 80% semantic-exact accuracy and 80% human-acceptable rate
on a fresh 10-case held-out validation, materially above Trial 3's frozen
zero-shot baseline (52.9% / 51% / 14.9%).

**Authoritative current result:**
`training/phase5a/benchmark/test1-final-result.md` — includes the final
validation numbers, the recorded planned-20/actual-10 protocol deviation,
what Test 1 did and did not prove, and the transition to Test 2.

**Full implementation walkthrough and addenda journal** (the original
architecture diagram, since-superseded provider/grading-model detail, the
task-contract v2/v3 evolution, the Dashboard build, and the evaluation-
stage upgrade) — moved out of the main reading path, preserved verbatim:
`docs/history/experiments/0017-trial4-implementation-journal.md`.

## Why this decision exists

Trial 3 (`docs/decisions/0016`) established a frozen, real, human-graded
zero-shot baseline for `Qwen3-0.6B` over local MLX: local runtime PASS,
zero-shot semantic capability FAIL (broad matrix 52.9%, A/B discrimination
51% — chance level, coarse feature classification 14.9%). That result
falsified zero-shot viability for this model class under Trial 3's
architecture. It did **not** test whether the same model, after
lightweight specialization, could do better — that is what Trial 4 tests.

## Operator decisions (recorded verbatim in intent, not paraphrased away)

### Decision 1 — Trial 4 uses human-filtered specialization, not autonomous LLM distillation

**DECIDED.** The training-data pipeline is
`LLM candidate generation -> human filtering -> tiny-model training`, not
`LLM generation -> LLM validation -> tiny-model training`. DeepSeek
generates candidate training examples; it is never the ground-truth
authority for what enters the dataset.

**Rationale (operator's own reasoning, recorded as given):** HDNA is
attempting to learn human revision/preference behavior. Allowing one LLM
to generate the training truth and another LLM to validate it risks
measuring LLM-to-LLM preference transfer rather than human behavioral
learning.

### Decision 2 — Human acceptance is the authoritative training-data filter

**DECIDED.** The review flow is deliberately `Accept` / `Reject` only for
the initial experiment. Only accepted examples become training data.
Automated schema/format validation is permitted (and is in fact performed
— see "Deterministic responsibilities" below), but semantic correctness
is never delegated entirely to another LLM. The goal is high-signal
human-approved data over maximum volume.

### Decision 3 — Optimize for dataset quality before dataset scale

**DECIDED (as an experimental target, not a permanent constraint).**
Initial target: ~500 generated candidates, ~200-300 accepted examples.
These numbers may change after the first result; they are not
architectural limits. Priority order: high-quality signal -> fast
training -> falsification, not dataset scale.

### Decision 4 — Qwen3-0.6B remains the initial student/control model

**DECIDED.** No other student model is evaluated in this first Trial 4
pass. **Rationale:** Trial 3 provides a frozen zero-shot baseline
specifically for this model (52.9% / 51% / 14.9%); holding the base model
constant isolates the effect of LoRA/SFT specialization from a
model-choice confound. A smaller model (e.g. SmolLM) may be tested later,
but only after the specialization hypothesis has been evaluated on
`Qwen3-0.6B` — this is an explicit, recorded scope boundary, not an
oversight (a prior draft of this same experiment briefly mentioned SmolLM
as a Trial 4 target and was corrected — see this branch's commit history
for that fix; SmolLM is not part of Trial 4's initial scope).

### Decision 5 — Frontier DeepSeek is a benchmark reference, not the source of truth

**DECIDED.** Three systems are compared during evaluation: untrained
`Qwen3-0.6B`, human-filtered trained `Qwen3-0.6B`, and frontier DeepSeek.
DeepSeek is a useful ceiling/reference; it does **not** determine whether
the trained Qwen answer is correct. Human evaluation and the held-out
benchmark remain authoritative. (This is also why the benchmark's DeepSeek
transport — originally a direct-API `DeepSeekSemanticRevisionJudge`,
later replaced by `OpenRouterSemanticRevisionJudge`, see
`docs/history/experiments/0017-trial4-implementation-journal.md` — is used
only inside the benchmark, and never as a training-data correctness oracle
— consistent with Decision 1.)

### Decision 6 — Benchmark comparison must be blind

**DECIDED.** Outputs are presented anonymously as A/B/C, randomized per
case, before the operator judges them; model identities may be revealed
only after judgment is recorded, and revealing must never change the
recorded judgment.

**Rationale:** reduces expectation bias toward the trained model (because
it was built), the untrained model (because it is the control), or
DeepSeek (because it is the frontier reference).

**Implementation note:** `Trial4BenchmarkResult.revealed` is a UI-only
display gate — the real `role` is always present in storage, exactly like
every other experimental config/data store in this codebase is "not
encrypted, local-only" rather than cryptographically hidden (same
disclosed-limitation discipline as `SemanticDeltaExtractorConfigStore`
and every config store since `docs/decisions/0015`). `reveal()` is
structurally incapable of mutating `grade`/`bestResponse`/`note` — it is
a separate method (`Trial4BenchmarkService.reveal()`) that never touches
the fields `submitJudgment()` sets, verified by test
(`trial4-benchmark-service.test.ts`'s "reveal" block).

### Decision 7 — Training and held-out falsification must remain separated

**DECIDED.** The Trial 3 held-out benchmark must never become training
material. Training-data generation must never consume held-out benchmark
examples. Failure categories may inform new dataset generation, but exact
held-out cases must remain isolated. Repeatedly optimizing against the
same held-out examples until they effectively become training data is
explicitly prohibited.

**Implementation note:** `training/phase5a/dataset/generate_candidates.py`
has no code path that reads any benchmark/held-out file — it only embeds
`training/phase5a/lore/task-contract.v3.md`'s contract and calls
OpenRouter (routed to a DeepSeek model by default). The
held-out benchmark corpus is operator-supplied directly into the
extension's `Trial4BenchmarkPanel` import (a separate `Trial4BenchmarkCaseStore`,
never touched by the training pipeline). `training/phase5a/benchmark/sample_case.json`
is an explicitly-labeled format fixture, not real benchmark data — its
companion README states the real corpus must never be generated or
committed.

### Decision 8 — Trial 4 is a fast concept-validation experiment

**DECIDED.** The immediate question is narrow: can a small amount of
high-quality, human-filtered training data make the same `Qwen3-0.6B`
model materially better at this task than the same model zero-shot? Until
demonstrated, out of scope: RLHF/DPO/PPO, model merging,
curriculum-learning infrastructure, multi-teacher ensembles, automated
synthetic-data scoring pipelines, large hyperparameter sweeps,
experiment-tracking platforms, production deployment infrastructure, and
any other generalized ML platform. Nothing in this scope list was
implemented.

### Decision 9 — HDNA development now has deterministic and learned research tracks

**DECIDED (broader operator direction, recorded for context).** HDNA
development is expected to evolve through two complementary tracks:

- **Deterministic track** — evidence capture, provenance, localization,
  storage, aggregation, retrieval, lifecycle behavior, and other
  components where deterministic solutions are appropriate (Trial 0-3's
  `revision-diff.ts`/`revision-intervention.ts`/`semantic-revision-admission.ts`
  are examples already in this codebase).
- **Learned semantic track** — continuously testing whether small local
  models can acquire semantic/persona capabilities deterministic
  representations cannot adequately express, via
  `versioned task/lore -> human-filtered training data -> tiny-model
  specialization -> held-out falsification -> failure-driven iteration`.

These tracks are complementary, not mutually exclusive. Deterministic
mechanisms are not to be replaced by learned ones where deterministic
behavior is already sufficient — this is a restatement of Trial 3's own
core architecture (push as much as possible into deterministic HDNA
logic, leave the model only the narrowest possible judgment), not a
reversal of it.

### Decision 10 — Lore/training contracts must remain traceable to the HDNA spec

**DECIDED.** No independent, uncontrolled body of model lore may become a
second source of truth. Training/task lore must be versioned and
traceable to HDNA specification decisions, Phase 5A task definitions,
observed failure classes, and explicit operator decisions. A trained
adapter should eventually be identifiable together with the spec/task-lore
version and dataset version used to produce it — this does not require a
full model registry in Trial 4.

**Implementation note:** `training/phase5a/lore/task-contract.v3.md` is
the current versioned, self-contained contract (v1/v2 superseded — their
evolution is preserved in Git history, not as competing active files);
its own rules trace to specific `docs/decisions/0016` sections and
observed Trial 0-3/Test 1 failure classes, no rule invented fresh for
training purposes. `training/phase5a/write_manifest.py` records the lore contract
version, base model id, dataset directory, example counts, and git commit
hash into `manifest.json` next to a trained adapter — a lightweight
identifier, not a registry.

### Decision 11 — Multi-agent execution must be cost-adaptive

**DECIDED.** Agents use the cheapest capable model and the lowest
sufficient reasoning effort for their assigned task; frontier/high-reasoning
agents are reserved for tasks that genuinely require deeper
architectural/research judgment. Duplicated agent work is avoided unless
independent verification provides real value.

**Applied in this implementation:** narrow, mechanical, precisely-specified
work (test-writing for already-designed modules; the standalone Python
training/dataset-generation scripts) was delegated to `haiku`-model
general-purpose agents with fully self-contained specs. Design-sensitive
work — the shared untrusted-JSON wire protocol, the DeepSeek provider, the
blind-randomization/reveal-integrity logic in `Trial4BenchmarkService`,
this decision record, and the task/lore contract — was done directly,
without delegation, because correctness there depends on continuity with
the full existing Phase 5A research history. No two agents were assigned
overlapping files; no duplicated verification was performed absent a
specific reason to.

### Decision 12 — Do not expand Trial 4 before the first trained-vs-untrained result

**DECIDED.** The first milestone is `human-filtered dataset -> one
Qwen3-0.6B LoRA/SFT -> frozen benchmark`. That result — positive or
negative — must exist before deciding on larger datasets, smaller student
models, additional teachers/candidate generators, more sophisticated
training objectives, hyperparameter optimization, or production
integration. This is an explicit scope-control decision, not a
default-caution disclaimer: this implementation stops exactly at "the
pipeline is ready to produce that first result," per the task that
produced it.

## Outcome / status today

**Decision 12's condition is satisfied.** The first trained-vs-untrained
result exists (see "Status" above) — larger datasets, a smaller student
model, and a more sophisticated (synthetic, filtered) training objective
are now explicitly sanctioned as Test 2, not a violation of Decision 12's
"do not expand before the first result" boundary. Test 2's direction
(automated synthetic distillation, ~5,000 accepted examples, planned
`google/gemma-3-270m-it` student, a completely fresh held-out benchmark)
is recorded in `training/phase5a/benchmark/test1-final-result.md`'s
"Direct transition to Test 2" section and `training/phase5a/README.md`.

The canonical localized edit-judgment contract is
`training/phase5a/lore/task-contract.v3.md` (+ its machine-readable
counterpart `training/phase5a/lore/policy-spec.v1.json`) — self-contained,
does not require this decision's original v1 lore contract (superseded,
preserved only in Git history) to understand.
