# 0017 — Phase 5A Trial 4: human-filtered tiny-model specialization + blind benchmark

## Status

**IMPLEMENTED — infrastructure only. No dataset has been generated, no
model has been trained, and no benchmark has been run.** This decision
records twelve explicit operator decisions (below) plus the resulting
implementation. Trial 3's real, recorded result
(`docs/decisions/0016`'s Trial 3 sections) remains the frozen baseline
this trial exists to test against — nothing in this document changes it.

Per the repository's conservative research-language convention (see
`docs/decisions/0016`), every claim below is labeled:

- **DECIDED** — an explicit operator policy choice, not a finding.
- **HYPOTHESIS** — a claim this trial is designed to test, not yet known.
- **NOT YET VALIDATED** — infrastructure exists; the real-world question it
  was built to answer has not been run.

Nothing in this document should be read as a claim that specialization
works, that the dataset pipeline produces good data, or that Phase 5A is
closer to its ≥80% acceptance threshold. **Phase 5A overall status remains
ITERATE.**

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
benchmark remain authoritative. (This is also why `DeepSeekSemanticRevisionJudge`,
described below, is used only inside the benchmark, and never as a
training-data correctness oracle — consistent with Decision 1.)

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
has no code path that reads any benchmark/held-out file — it only reads
`training/phase5a/lore/task-contract.v1.md` and calls DeepSeek. The
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

**Implementation note:** `training/phase5a/lore/task-contract.v1.md` is
the single versioned contract; its own "Traceability" section maps every
rule to a specific `docs/decisions/0016` section or observed Trial 0-3
failure class (no rule was invented fresh for training purposes).
`training/phase5a/write_manifest.py` records the lore contract version,
base model id, dataset directory, example counts, and git commit hash
into `manifest.json` next to a trained adapter — a lightweight identifier,
not a registry.

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

## What was implemented (infrastructure only — see "Status" above)

### Architecture

```text
DeepSeek (candidate/stimulus generation only, per Decision 1)
    |
    v
training/phase5a/dataset/generate_candidates.py  -->  candidates.json
    |
    v
[operator imports into the extension]
    |
    v
Trial4TrainingReviewPanel.svelte  (Accept / Reject, one at a time)
    |
    v
[operator exports accepted examples from the extension]
    |
    v
training/phase5a/dataset/split_dataset.py  -->  train/valid/test.jsonl
    |
    v
training/phase5a/train_lora.sh  (wraps mlx_lm.lora)  -->  adapter + manifest.json
    |
    v
[operator starts two mlx_lm.server instances: base (8080), trained w/ --adapter-path (8081)]
    |
    v
Trial4BenchmarkPanel.svelte
    |  for each held-out case, calls all three:
    |    base   -> LocalMlxSemanticRevisionJudge(baseModelUrl)
    |    trained-> LocalMlxSemanticRevisionJudge(trainedModelUrl)   [same class, different port/adapter]
    |    deepseek -> DeepSeekSemanticRevisionJudge
    v
Trial4BenchmarkService.runNextCase()  -->  blinded Trial4BenchmarkResult (A/B/C, role hidden by UI only)
    |
    v
operator grades blind (Correct/Partial/Wrong + Best A/B/C/Tie + note) -> submitJudgment()
    |
    v
operator reveals identities -> reveal() (never touches the recorded judgment)
    |
    v
computeTrial4BenchmarkStats() -> base/trained/DeepSeek correctness, trained-vs-base improvement, win rates
```

**No new judging contract was invented.** Every system in the benchmark
implements the exact same `SemanticRevisionJudgeProvider` interface Trial
3 already established (`@spec/protocol/semantic-revision-judge.ts`) — a
benchmark case is structurally identical to a `SemanticRevisionJudgeInput`
plus a stable `id` (`spec/schema/trial4-benchmark-case.ts`). This is the
"reuse the existing Trial 3 quantitative evaluation" requirement, applied
literally rather than approximately.

### New provider: `DeepSeekSemanticRevisionJudge`

`extension/src/persona/deepseek-semantic-revision-judge.ts`. Verified
against DeepSeek's own published API docs (api-docs.deepseek.com) before
implementation, not assumed: base URL `https://api.deepseek.com`, chat
completions at `/chat/completions` (no `/v1` segment — verified, not
inferred from the OpenAI-compatible convention other APIs happen to
follow), `Authorization: Bearer <key>`, and `response_format: {type:
'json_object'}` support — described in DeepSeek's own docs as
prompt-engineering-assisted "JSON mode," explicitly **not** strict
JSON-Schema enforcement, with a documented caveat that content can
occasionally come back empty. Accordingly, this provider sends the hint
but never trusts it: the response is parsed and validated by the exact
same untrusted-output discipline as `LocalMlxSemanticRevisionJudge`.

### Shared wire protocol, extracted rather than duplicated

`extension/src/persona/semantic-revision-judge-wire.ts` (new) — the narrow
judge prompt (`buildNarrowJudgePrompt`) and untrusted-JSON parsing
(`parseUntrustedJudgmentText`, tolerating only whitespace, one `<think>`
block, and one Markdown fence — never repairing a malformed field) were
extracted out of `local-mlx-semantic-revision-judge.ts` into this shared
module and reused by `DeepSeekSemanticRevisionJudge`, specifically so a
Trial 4 benchmark comparing outputs across transports is not confounded
by prompt differences between them. `local-mlx-semantic-revision-judge.ts`
was refactored to use this module; its own behavior and all of its
existing tests are unchanged (verified — see "Tests" below).
`OpenRouterSemanticRevisionJudge` (Trial 3's original, now-unused transport)
is untouched and does not use this module — it relies on OpenRouter's
`response_format: json_schema` strict structured output instead, a
materially stronger wire guarantee this module does not replicate.

### New schemas/stores (extension)

- `spec/schema/trial4-training-candidate.ts` — one DeepSeek-proposed
  candidate + the operator's `pending`/`accepted`/`rejected` decision.
  Shape deliberately mirrors `SemanticRevisionJudgeInput`/
  `SemanticRevisionJudgmentDraft` so an accepted candidate exports
  directly into the `{prompt, completion}` shape `split_dataset.py` needs,
  with no translation step.
- `spec/schema/trial4-benchmark-case.ts` — one held-out case (`SemanticRevisionJudgeInput` + `id`).
- `spec/schema/trial4-benchmark-result.ts` — one blind three-way result:
  `labelMapping: Record<'A'|'B'|'C', Trial4BenchmarkResponse>` (each
  response always carries its real `role`, plus `verdict`/`description`/
  `confidence`/`error`/`grade`), `bestResponse`, `note`, `judged`,
  `revealed`.
- `Trial4TrainingCandidateStore`/`Trial4BenchmarkCaseStore` — `CACHE`
  storage class (disposable, reproducible-by-reimport experimental data,
  never canonical persona evidence).
- `Trial4BenchmarkResultStore` — `DERIVED` (the actual experimental
  output this trial exists to produce, not reproducible from an input
  file alone).
- `Trial4BenchmarkConfigStore` — `chrome.storage.local`-direct, holding
  `{enabled, baseModelUrl, trainedModelUrl, localModelId, deepSeekApiKey,
  deepSeekModelId}`. A structurally separate store from Trial 3's
  `SemanticRevisionJudgeConfigStore` — Trial 4 needs three live endpoints
  simultaneously, and this store has no field that could conflate a
  DeepSeek key with a local/OpenRouter config.

### Orchestration: `Trial4BenchmarkService`

`extension/src/persona/trial4-benchmark-service.ts`. `runNextCase()`
picks the next held-out case with no existing result (a case is
benchmarked exactly once — Decision 7's "do not repeatedly optimize
against the held-out benchmark"), calls all three providers concurrently,
randomizes which A/B/C label each role lands on
(`Math.random`-based Fisher-Yates shuffle, injectable for tests), and
persists the result unjudged/unrevealed. A provider failure for one role
is recorded as that label's `error` (still gradeable, almost always as
`'wrong'`) rather than aborting the case — the same "untrusted output, no
silent failure" discipline Trial 3 established. `submitJudgment()` and
`reveal()` are two structurally separate methods — `reveal()` has no code
path that can reach `grade`/`bestResponse`/`note` (Decision 6's
non-mutation requirement, verified by test).

### Popup UI (extension/src/ui/)

- `Trial4TrainingReviewPanel.svelte` — imports a candidates JSON file,
  shows exactly one pending candidate at a time (evidence + DeepSeek's
  proposed verdict/description), `Accept`/`Reject` buttons with keyboard
  shortcuts (`A`/`R`) for fast review of "hundreds of candidates" (per the
  task's explicit requirement), and an "Export accepted" button
  (client-side JSON download, no server round-trip). No annotation
  taxonomy, scoring, or editing — exactly the "Accept/Reject only" MVP
  Decision 2 specifies.
- `Trial4BenchmarkPanel.svelte` — imports held-out cases, a "Run next
  case" button (enqueues the P3 `run_trial4_benchmark_case` job), blind
  A/B/C display (role hidden until `revealed`), per-label Correct/Partial/
  Wrong grading, Best-response A/B/C/Tie selection, optional note, Submit,
  then Reveal, and an aggregate-stats section
  (`computeTrial4BenchmarkStats()` — base/trained/DeepSeek correctness,
  trained-vs-base improvement, blind win/tie counts) computed live from
  stored results.

Both panels follow this codebase's established job/queue conventions
exactly: model-calling work (`runNextCase`) goes through the existing P3
`enqueueSingleton` job-queue pattern (`trial4-benchmark-job.ts`, mirroring
`semantic-revision-judge-job.ts`); config saves and grading/reveal are
direct, synchronous storage writes with no model call involved (mirroring
every other experimental panel in this codebase), picked up by the
popup's existing 2-second `refresh()` poll.

### Standalone Python pipeline (training/phase5a/) — no extension code

Completely separate from the Chrome extension (browsers cannot run LoRA
training). Verified against the actually-installed `mlx-lm==0.29.1`
before writing anything (not assumed): the LoRA CLI is `mlx_lm.lora`
(`python -m mlx_lm.lora` is deprecated), accepting `--data DIR` (a
directory of `train.jsonl`/`valid.jsonl`/`test.jsonl`), and — read
directly from `mlx_lm/tuner/datasets.py`'s source — a `{"prompt": ...,
"completion": ...}` JSONL "completions" format is natively supported,
chosen here specifically because it lets `split_dataset.py` write the
model's training target using the identical wire format
(`{"verdict":..., "description":..., "confidence":...}`) the extension's
providers already parse.

- `lore/task-contract.v1.md` — the versioned task/lore contract (Decision
  10), traced to specific `docs/decisions/0016` sections and observed
  failure classes.
- `dataset/generate_candidates.py` — calls DeepSeek only (never reads any
  benchmark file), embeds the lore contract, cycles through topic seeds
  for diversity, writes incrementally/resumably to
  `dataset/generated/candidates.json` (gitignored).
- `dataset/split_dataset.py` — filters an extension-exported file to
  `decision === 'accepted'` only, builds the exact prompt text (verified
  character-for-character identical to the TypeScript providers' prompt),
  and writes an 80/10/10 train/valid/test split (gitignored output).
  Confidence in the synthetic completion target is a documented
  placeholder heuristic (0.9 for change verdicts, 0.6 for
  abstention/uncertain) — not a calibrated value, since this is a
  concept-validation dataset.
- `train_lora.sh` — wraps `mlx_lm.lora ... --fine-tune-type lora
  --mask-prompt ...` with overridable env vars, then calls
  `write_manifest.py` automatically.
- `write_manifest.py` — records lore-contract version, base model,
  dataset counts, git commit, and timestamp next to the trained adapter
  (Decision 10's lightweight traceability, not a model registry).
- `benchmark/sample_case.json` + README — an explicitly-labeled fixture
  only; its README states the real held-out corpus must be operator-
  supplied and must never be generated or committed (Decision 7).
- `.gitignore` — excludes generated candidates, prepared datasets, and
  adapters/model weights; keeps scripts, README, lore, and the two tiny
  sample fixtures.

### Tests

96 new tests (haiku-authored, verified passing + `tsc --noEmit` clean
before acceptance) for: `Trial4TrainingCandidateStore`,
`Trial4BenchmarkCaseStore`, `Trial4BenchmarkResultStore`,
`Trial4BenchmarkConfigStore`, `DeepSeekSemanticRevisionJudge` (request
shape, auth header present — unlike LocalMlx — `response_format` hint
sent, provider identity, malformed-output rejection, prompt contract),
and `semantic-revision-judge-wire.ts` (every verdict, whitespace/fence/
think-block tolerance, malformed rejection). Plus 23 tests written
directly (not delegated, given the correctness-sensitive invariants
involved) for `Trial4BenchmarkService` (blind randomization actually
determines label-to-role assignment; a provider failure for one role
never aborts the case; a case is benchmarked exactly once; `reveal()`
never mutates `grade`/`bestResponse`/`note`; re-judging an already-judged
result throws; providers are constructed fresh from current config every
call) and `computeTrial4BenchmarkStats` (unjudged results excluded;
per-role correct/partial/wrong/error counts; correctRate never NaN on
zero judged; trained-vs-base improvement can be negative; win/tie
counting). **652/652 tests pass across the full suite** (all Trial 0-3
tests unmodified and still passing), clean `tsc --noEmit`, clean
`wxt build`.

## Explicitly not done (per Decisions 8 and 12, and the task's own scope)

No dataset has been generated. No human review has occurred. No LoRA
training run has happened. No adapter exists. No benchmark case has been
run. No `SUPPORTED`/correctness number of any kind exists for Trial 4.
RLHF/DPO/PPO, model merging, curriculum learning, multi-teacher ensembles,
automated dataset scoring, hyperparameter sweeps, experiment-tracking
platforms, and production deployment infrastructure were not built. No
student model other than `Qwen3-0.6B` was evaluated or wired up.

## How to run Trial 4 once ready (operator steps)

See `training/phase5a/README.md` for the exact end-to-end command
sequence (generate -> review in the extension -> export -> split ->
train -> serve two local endpoints -> configure the extension's Trial 4
Benchmark panel -> import the real held-out corpus -> run/grade/reveal
in the extension -> read aggregate stats from the panel).

## Known limitations / concerns going into a real run

- `split_dataset.py`'s placeholder confidence values (0.9/0.6) are not
  learned or calibrated — the trained model's own confidence outputs
  after fine-tuning are themselves an open question, not fixed by this
  choice.
- DeepSeek's own documented "JSON mode" caveat (occasional empty content)
  means `DeepSeekSemanticRevisionJudge` can and will sometimes fail — this
  is treated as a per-role benchmark error (gradeable, visible), not
  silently retried or hidden.
- Whether ~200-300 accepted examples is enough signal for a visible
  LoRA effect on a 0.6B model is itself an open, untested question this
  trial is designed to answer — not assumed favorably by this
  implementation.
- The `'replaced' -> contrastive_preference` structural admission
  heuristic from Trial 3 is unrelated to and unaffected by this trial;
  Trial 4 does not touch Trial 3's admission logic at all (this
  benchmark's outputs are graded directly by the operator, not passed
  through `admitJudgment()`).
