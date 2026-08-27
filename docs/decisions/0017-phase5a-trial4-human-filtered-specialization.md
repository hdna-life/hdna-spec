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
`training/phase5a/lore/task-contract.v1.md` and calls OpenRouter (routed
to a DeepSeek model by default). The
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

**Implementation note:** `training/phase5a/lore/task-contract.v1.md` (now
superseded by `v2.md` — see the "Trial 4 addendum: task-contract v2"
section below) is the versioned contract; its own "Traceability" section
maps every rule to a specific `docs/decisions/0016` section or observed
Trial 0-3 failure class (no rule was invented fresh for training
purposes) — v2 extends this discipline to an explicit operator decision
made from Trial 4's own first human-review pass, still traced rather than
asserted. `training/phase5a/write_manifest.py` records the lore contract
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

## What was implemented (infrastructure only — see "Status" above)

### Architecture

```text
OpenRouter, routed to DeepSeek by default (candidate/stimulus generation only, per Decision 1)
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
- `dataset/generate_candidates.py` — calls OpenRouter only (never reads
  any benchmark file), routed by default to a DeepSeek model
  (`deepseek/deepseek-chat`, substitutable via `--model` to any
  OpenRouter-hosted model) — the same gateway Trial 0-3 already use
  elsewhere in this codebase, so training-data generation and Trial 0-3
  share one API-key/billing surface rather than a second, DeepSeek-direct
  one. Embeds the lore contract, cycles through topic seeds for
  diversity, writes incrementally/resumably to
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

## Trial 4 addendum: task-contract v2 (failure-driven refinement)

**Status: IMPLEMENTED.** After the operator's first human-review pass
over 30 candidates generated under `task-contract.v1.md`, a systematic
misclassification pattern was found: candidates whose two spans discussed
the same underlying factual topic were being proposed/reviewed as
`no_meaningful_change` even when hedging, certainty, intensity,
commitment, directive strength, qualification, rationale, framing, or
scope had genuinely shifted. This is a real, human-observed failure
class from Trial 4's own data — not a hypothetical one, and not
retroactively reinterpreting Trial 0-3.

**What changed.** `training/phase5a/lore/task-contract.v2.md` (new file —
per the contract's own versioning rule, `v1.md` is preserved unchanged,
not edited in place) adds one substantive rule, §2.1: "A changed factual
topic is not required for a meaningful change." The rule states plainly
that "same topic" is not "same meaning," gives two worked examples
(certainty: "This might help" -> "This will fix"; directive strength:
"You should consider running the tests" -> "Run the tests"), and clarifies
what it does *not* change — a genuinely meaning-preserving same-topic
rewording remains correctly `no_meaningful_change`; §2.1 corrects a
specific *over-application* of that rule, not the rule itself. Three
other sections got one added sentence each restating the same correction
in context (§3's "must not produce" list, §4's `'replaced'` kind-specific
note, §5's abstention note); everything else in v1 is unchanged. This is
recorded as `v2`, not a silent edit — consistent with §"Decision 10" and
the contract's own stated versioning discipline.

`training/phase5a/dataset/generate_candidates.py`'s embedded
`TASK_CONTRACT` string and its `KEY DISCIPLINE` prompt block were both
updated to match `v2.md`: the script's own docstring/comments now name
`task-contract.v2.md`, the embedded contract text includes §2.1 and its
two worked examples, and a new `KEY DISCIPLINE` bullet explicitly
instructs the generator to include a meaningful share of same-topic/
shifted-force examples labeled `meaning_transformed` (or added/removed as
appropriate), never `no_meaningful_change`, purely because the topic
didn't change. `training/phase5a/README.md` and this decision's own
cross-references were updated to point at `v2.md`.

**No architecture or scope change.** This is a prompt/lore-content
refinement only, per the operator's explicit instruction. It does not
touch `Trial4BenchmarkService`, `DeepSeekSemanticRevisionJudge`,
`split_dataset.py`'s conversion logic, `train_lora.sh`, any extension
schema/store/UI, or any of Decisions 1-12 above. `generate_candidates.py`
recompiles cleanly (`py_compile`) after the change; `--help` output is
unaffected.

**A second, independent 30-candidate batch was requested for the next
human-review pass**, generated under v2 rather than appended to the first
(v1) batch, so the two batches remain distinguishable for review
purposes. Generating it requires a real `OPENROUTER_API_KEY` and makes
real, billed API calls — both outside what this implementation session
has credentials for. The exact operator command (writing to a separate
output file, not overwriting or merging with the first batch):

```bash
cd training/phase5a
export OPENROUTER_API_KEY=sk-or-...
python3 dataset/generate_candidates.py \
  --count 30 \
  --model deepseek/deepseek-chat-v3.1 \
  --out dataset/generated/candidates-v2-batch1.json
```

This has not been run as part of this task. No new candidates exist in
this repository as a result of this addendum — only the contract and
generator-prompt changes described above.

## Trial 4 addendum: generation-reliability simplification + concurrency + Turkish review support

**Status: IMPLEMENTED.** Three related operator requests, addressed
together since the third depends on the first two's request/response
shape.

### 1-request-1-candidate (reliability simplification)

Real generation runs surfaced brittle behavior in the original batched
design (`--batch-size 8`, one response containing an array of candidates):
some batches returned as few as 1 valid candidate out of 8 requested,
some returned 0, and some requests timed out entirely. Per the operator's
explicit instruction, this was **not** addressed with more parsing/repair
logic — it was addressed by shrinking the unit of work. Every request now
asks the model for exactly one candidate object (`generate_single_candidate_prompt()`
replaces the old `generate_batch_prompt()`); `parse_single_response()`
replaces `parse_batch_response()` and does only the same minimal,
non-recovering normalization already established elsewhere in this
codebase (whitespace trim, one optional Markdown fence strip — the same
tolerance `semantic-revision-judge-wire.ts`'s `parseUntrustedJudgmentText()`
uses) — any other malformation is an invalid response, not a repair
target. A failed or invalid single-candidate request retries up to
`MAX_RETRIES_PER_CANDIDATE = 3` times, in isolation; after that it is
skipped and generation continues — one bad candidate can never abort or
corrupt any other.

`--count` now means the target number of **valid persisted candidates**
(existing + new), not a request count — `run_generation()` keeps issuing
individual requests until that many valid candidates exist on disk, or a
bounded global failure limit (`max(50, remaining_target * 5)`) is hit,
whichever comes first; hitting the limit exits non-zero with a clear
message rather than looping forever. `--batch-size` was removed (no
longer meaningful); resumability is unchanged — `load_existing_candidates()`
is untouched, and already-written candidates are never re-requested or
duplicated.

### Concurrency (4 workers by default)

Per the follow-up request, generation runs up to `--concurrency` (default
`4`) single-candidate requests at once via Python's stdlib
`concurrent.futures.ThreadPoolExecutor` — explicitly not a new dependency
and not "a larger async orchestration framework," per the operator's
stated constraint. `run_generation()` primes the pool with `concurrency`
tasks, then replaces each completed task with a new one (via
`concurrent.futures.wait(..., return_when=FIRST_COMPLETED)`) until the
target is reached or the failure budget is exhausted. Each worker task
(`generate_one_candidate_with_retries()`) owns its own full retry loop
and is fully independent — one worker's failure/timeout never affects any
other in-flight worker. Output writes are serialized behind a single
`threading.Lock` (`output_candidate()`) so concurrent workers can never
interleave or corrupt JSONL lines.

**A real concurrency bug was found and fixed during implementation,
before any real API run.** An offline smoke test (mocked `call_openrouter_api`,
no real network calls, run standalone — not part of the pytest/vitest
suites, since this is a throwaway verification script, not a persisted
test file) simulating realistic failure/invalid-response rates caught
that persisted count could **overshoot** the target: when multiple
workers completed in the same `wait()` batch, each was checked against
the target *before* any of that batch's increments were applied, so more
than one could pass the check and all get persisted. Fixed by making the
target check-and-increment atomic under the same lock that guards
`state["persisted"]` — a candidate is now persisted only if
`state["persisted"] < remaining_target` at the moment its own increment
is applied; any valid candidate arriving after the target is already met
is discarded (not persisted), which is what keeps `--count 20` producing
*exactly* 20 persisted candidates rather than "20 or a few more."
Verified stable across 5 repeated stochastic runs at concurrency 4 after
the fix (no overshoot, no undershoot, no duplicate/corrupted lines), plus
a dedicated bounded-failure-exhaustion run (all calls fail -> stops at
the failure budget, doesn't hang) and a dedicated resumability run
(pre-seeded existing candidates are read correctly and never touched).

### Turkish operator review support

The operator does not read English comfortably enough to reliably judge
every candidate. Per the explicit requirement, the canonical candidate
and training data remain English-only; a **`reviewNoteTr`** field was
added carrying a short Turkish-language explanation of the original ->
final change and the proposed verdict, for review purposes only.

**Generated in the same request, not a second call** — per the operator's
explicit preference ("prefer generating the Turkish review text during
candidate generation... do not make a second LLM request solely for
translation unless necessary"). `generate_single_candidate_prompt()` asks
for `reviewNoteTr` as an eighth required field alongside the existing
seven; `parse_single_response()`/`REQUIRED_FIELDS` require it to be a
non-empty string on every candidate, regardless of verdict (including
`no_meaningful_change`/`uncertain`, where an explanation is still useful
even though `proposedDescription` is null for those verdicts).

**Structurally cannot enter training data or the task/lore contract.**
`spec/schema/trial4-training-candidate.ts`'s `Trial4TrainingCandidate.reviewNoteTr`
is documented as review-assistance-only and optional (so pre-existing
candidates without it remain valid). `training/phase5a/dataset/split_dataset.py`'s
`candidate_to_example()` — the only code path that turns an accepted
candidate into a training example — reads only
`kind`/`beforeContext`/`originalText`/`finalText`/`afterContext`/
`proposedVerdict`/`proposedDescription`; it was given an explicit comment
documenting that `reviewNoteTr` is deliberately never read there, so the
exclusion is structural (the field literally never reaches
`candidate_to_example`'s scope), not merely a convention someone could
accidentally violate. `training/phase5a/lore/task-contract.v2.md` was not
touched — the Turkish field is UI/generation-pipeline plumbing, not a
change to what the model is asked to learn.

**Extension UI:** `Trial4TrainingReviewPanel.svelte` now displays
`reviewNoteTr` (labeled, in Turkish, as review assistance that does not
enter training) directly under the existing English proposed-verdict/
description block, when present. The operator's Accept/Reject decision
remains the only thing that determines training-set membership — the
Turkish note is display-only and participates in no decision logic.
`App.svelte`'s `importTrial4Candidates()` handler needed no change: it
already spreads (`{...raw, ...}`) each imported candidate object, so
`reviewNoteTr` passes through automatically without a dedicated code path.

### Scope discipline

Per the operator's explicit instructions on all three requests: no change
to the task/lore contract's rules (`v2.md`'s content is untouched by this
addendum), no change to the candidate schema's existing required fields
(only one new *optional* field added), no change to
`Trial4BenchmarkService`/`DeepSeekSemanticRevisionJudge`/`train_lora.sh`/
`write_manifest.py`, and no larger async/orchestration framework —
`ThreadPoolExecutor` plus one lock is the entire concurrency
implementation. `tsc --noEmit` clean, `wxt build` clean, 652/652 existing
tests still pass (none needed updating — `reviewNoteTr` is optional, and
no existing test constructs a `Trial4TrainingCandidate` fixture that
would be affected by adding it).

### Not done in this addendum

No real generation run — the `--count 10` and `--count 20 --concurrency 4`
validation runs the operator was asked to perform still require a real
`OPENROUTER_API_KEY` and make real, billed API calls, both outside this
session's credentials. The exact commands:

```bash
cd training/phase5a
export OPENROUTER_API_KEY=sk-or-...
python3 dataset/generate_candidates.py --count 10
# confirm exactly 10 valid candidates persisted, then:
python3 dataset/generate_candidates.py --count 20 --concurrency 4 --out dataset/generated/validation-run.json
# confirm exactly 20 valid candidates persisted, then proceed to the full run.
```

## Trial 4 addendum: structured review decisions + HDNA Dashboard

**Status: IMPLEMENTED.** Two related operator requests, addressed
together since the Dashboard's primary content is the review workflow the
first request restructures.

### Structured human review decisions (replaces binary Accept/Reject)

The prior `Trial4TrainingCandidateDecision = 'pending' | 'accepted' |
'rejected'` field collapsed three genuinely independent judgments into
one state. Per the operator's explicit instruction, `Trial4TrainingCandidate`
(`spec/schema/trial4-training-candidate.ts`) now separates them:

1. **Human semantic verdict** (`humanVerdict: SemanticChangeVerdict |
   null`) — the correct label, becoming training ground truth.
   `proposedVerdict`/`proposedDescription` (DeepSeek's originals) are
   **never overwritten** — both values are always preserved, so
   human/model disagreement stays inspectable after the fact.
2. **Training eligibility** (`includeInTraining: boolean` +
   `exclusionReasons: Trial4ExclusionReason[]` + `operatorNoteTr: string`)
   — should this example train the model? A closed, ten-value reason enum
   (`synthetic_or_unrealistic`, `insufficient_context`,
   `malformed_original_or_final`, `wrong_intervention_boundary`,
   `too_easy_low_training_value`, `duplicate_or_near_duplicate`,
   `misleading_turkish_explanation`, `description_not_supported_by_edit`,
   `does_not_fit_category`, `other`) plus free-text Turkish note, exactly
   matching the operator's specified list; multiple reasons allowed per
   candidate. An excluded candidate's `humanVerdict` stays `null` — the
   operator is never required to pick a semantic label for something
   they're throwing out.
3. **Lore evidence** (`loreImportant: boolean` + `loreNoteTr: string |
   null`) — fully independent of 1 and 2, verified by construction: no
   code path in the review UI or the pure state module ties
   `loreImportant` to either `humanVerdict` or `includeInTraining`. A
   candidate can be excluded from training and lore-important
   simultaneously, or included and lore-important, in any combination —
   exactly the worked examples the operator gave (an unrealistic
   `added`-kind candidate: excluded, still lore-important, with an
   explanation of why generation was wrong; a same-topic hedging shift:
   included as `no_meaningful_change`, also lore-important, with the
   operator's own-words explanation of the boundary).

`reviewedAt` (unchanged field) remains the sole "has this candidate ever
been decided" signal — its absence is `'pending'`, distinguishing an
unreviewed candidate (`includeInTraining: false` by default) from an
explicitly excluded one (`includeInTraining: false` **and** `reviewedAt`
set) — a distinction `extension/src/persona/trial4-review-state.ts`'s
`isExcluded()`/`isPending()` make explicit and testable, since the two
states share the same `includeInTraining` value.

**Pure state module, not UI-embedded logic.** `trial4-review-state.ts`
(new) provides `VERDICT_LABELS_TR`/`EXCLUSION_REASON_LABELS_TR` (Turkish
display labels, matching the operator's exact wording), `filterCandidates()`
(six filters: `all`/`pending`/`disagreement`/`lore`/`excluded`/`included`),
`computeReviewStats()`, and the three export builders below — all pure
functions over a candidate array, no storage access, unit-tested (47
tests) independent of any Svelte component.

### Three export artifacts (evidence, not automation)

`buildTrainingDatasetExport()`/`buildLoreEvidenceExport()`/
`buildGenerationFailuresExport()` produce exactly the three files the
operator specified — `training-dataset.json` (included candidates,
human verdict as ground truth), `lore-evidence.json` (lore-important
candidates, independent of inclusion), `generation-failures.json`
(excluded candidates with their reasons/notes) — surfaced in the
Dashboard's Data/Exports page as client-side JSON downloads (no server
round-trip, same pattern the original Trial 4 UI already used). **Per
the operator's explicit instruction, nothing in this codebase reads these
exports automatically** — no retraining, regeneration, or lore-contract
modification is triggered by producing them; `split_dataset.py` and
`task-contract.v2.md` are both untouched by this addendum. They are
evidence for the next explicit, human-made failure-driven decision.

### HDNA Dashboard — full-page operator surface

A new unlisted WXT entrypoint, `extension/entrypoints/dashboard/`
(`index.html`/`main.ts`/`App.svelte`), builds to `dashboard.html` and is
opened from the popup via `chrome.tabs.create({ url:
chrome.runtime.getURL('/dashboard.html') })` — verified this requires no
"tabs" permission (Chrome's own docs: `tabs.create()` needs no
permission; only reading another tab's `url`/`title`/`favIconUrl` does),
so the manifest's permission set is unchanged from before this addendum.

**Popup became a compact launcher**, per the operator's explicit
instruction ("Keep only compact essentials... Do not put large review
workflows, benchmark tables, long descriptions, or dense forms in the
popup"). `Trial4TrainingReviewPanel.svelte` (the old compact
Accept/Reject panel) is deleted outright — superseded, not left as dead
code — and `Trial4BenchmarkPanel.svelte` was removed from the popup's
render tree entirely; the popup's `App.svelte` now only reads enough
Trial 4 state (`computeReviewStats()`/`computeTrial4BenchmarkStats()`,
both reused unchanged from their existing modules) to show one summary
line and an "Open HDNA Dashboard" button. Every Trial 4 write handler
(`importTrial4Candidates`, `decideTrial4Candidate`, benchmark
import/run/grade/reveal/config-save) was deleted from the popup and
re-created in the Dashboard's own `App.svelte`, which owns its own
`IndexedDbStorageAdapter`/`JobQueue`/store instances — the same
per-entrypoint wiring pattern the popup and background service worker
already each use independently against the same shared IndexedDB-backed
storage. The Dashboard also registers as a foreground surface via the
same `FOREGROUND_PORT_NAME` connection the popup uses, so a long review
session keeps the background dispatch loop out of `DEEP_IDLE` exactly
like an open popup would.

**No scope invented beyond what the operator specified.** The sidebar
navigation is exactly the five items requested — Overview, Training
Review, Benchmark, Data/Exports, Settings:

- **Overview** — `DashboardOverview.svelte` shows only real, derived
  numbers (`computeReviewStats()` for the training-dataset card,
  `computeTrial4BenchmarkStats()` — Trial 4's existing stats module,
  reused unchanged — for the benchmark card). Per the operator's explicit
  "do not fabricate placeholder results" instruction, every
  benchmark-percentage stat is conditionally rendered only when its
  `judgedCount > 0`; an empty benchmark shows "Henüz benchmark koşulmadı"
  (no benchmark run yet) rather than a 0%/blank number.
- **Training Review** — `DashboardTrainingReview.svelte` is the
  structured-decisions workspace: large typography (16-19px body text,
  vs. the popup's original 12-13px), generous block spacing, and clearly
  separated Context/Original/Final/DeepSeek-proposal/Turkish-assistance/
  Your-decision sections, exactly as specified. Productivity features:
  keyboard shortcuts (`1`-`5` select a verdict and auto-advance, `X`
  enters exclusion mode, `L` toggles lore-important, `←`/`→` or `P`/`N`
  navigate) guarded against firing while the operator is typing in a
  note/textarea field; auto-save on every decision-affecting change (no
  explicit "Save" button — verdict/reason/lore-toggle clicks dispatch
  immediately, free-text notes save on blur); a progress bar
  (`reviewed / total`); and the six-way filter bar including the
  human/model-disagreement and lore-important filters the operator
  specifically asked for. "Resume position" is achieved structurally, not
  via a separately-persisted cursor: the default `pending` filter
  naturally shows the next undecided candidate at the same list position
  once a decision removes the current one from that filter — no extra
  state needed. No confirmation dialogs anywhere in the decision flow.
- **Benchmark** — `Trial4BenchmarkPanel.svelte` is reused **unmodified in
  structure/logic**, per "Do not redesign the benchmark methodology" —
  only its `<style>` block was enlarged (12-13px → 14-19px, more padding)
  now that it renders in the full-page Dashboard rather than the cramped
  popup. Blind A/B/C grading, randomized label mapping, and reveal-never-
  mutates-the-judgment behavior are all byte-for-byte unchanged from
  Trial 4's original benchmark implementation.
- **Data/Exports** — `DashboardExports.svelte` shows a live count and a
  download button for each of the three artifacts above.
- **Settings** — `DashboardSettings.svelte` reuses the existing
  `Controls.svelte` component (processing/learning pause toggles — a
  real, pre-existing global setting, not invented for this page) plus a
  short reference block pointing to where Trial 3/Trial 4 model-endpoint
  configuration actually lives (Benchmark page's settings form; the
  popup's existing Semantic Delta Extraction panel) — deliberately not
  duplicating those forms in a second location.

**No HDNA architecture, training methodology, or benchmark methodology
change.** This addendum is UI/schema-organization only: the deterministic
Trial 0-3 pipeline, `Trial4BenchmarkService`, `DeepSeekSemanticRevisionJudge`,
`training/phase5a/`'s Python scripts, and the task/lore contract are all
untouched.

### Tests and validation

`extension/tests/persona/trial4-review-state.test.ts` (new, 47 tests)
covers every exported label map, predicate, filter, stats function, and
export builder in `trial4-review-state.ts`, including the
excluded-vs-pending distinction specifically. `extension/tests/persona/trial4-training-candidate-store.test.ts`
was updated in place for the new candidate shape (no store logic
changed — it's a generic CRUD store; only the fixture helper's field set
changed). **699/699 tests pass** (652 prior + 47 new), clean `tsc
--noEmit`, clean `wxt build` — the build now also emits `dashboard.html`
as a genuinely separate, unlisted entrypoint bundle
(`chunks/dashboard-*.js`, `assets/dashboard-*.css`), confirmed via the
actual build output. The built manifest's `permissions`/`host_permissions`
are byte-for-byte unchanged from before this addendum (verified against
`.output/chrome-mv3/manifest.json`), confirming the "no `tabs` permission
needed" analysis held in practice, not just in theory.

**Not done as part of automated validation:** no real browser session was
used to click through the Dashboard end-to-end (loading an unpacked MV3
extension into a real Chrome instance and interacting with it was outside
what this session's tooling could drive safely/practically). `tsc
--noEmit` does not type-check `.svelte` files in this project (no
`svelte-check` is configured) — every `.svelte` file change was instead
verified via a full `wxt build` (which does catch Svelte-compiler-level
errors) and, for the schema-shape change specifically, an explicit grep
across `extension/src`/`extension/entrypoints`/`extension/tests` for
every remaining reference to the deleted `decision`/
`Trial4TrainingCandidateDecision` fields before considering the migration
complete.
