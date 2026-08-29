# Evidence

What has actually been demonstrated, what has failed, and what has not
been demonstrated yet. Every demonstrated claim links to a repository
artifact.

## 1. Demonstrated

**A tiny local model can learn HDNA's narrow v3 localized edit-judgment
policy via LoRA specialization.**

- Student: `Qwen/Qwen3-0.6B`, LoRA/SFT on 183 human-reviewed examples.
- Final held-out validation: 10 fresh Turkish cases, ground truth locked
  before model outputs were shown, blind A/B/C review.
- Result: 80% semantic-exact accuracy, 80% human-acceptable rate — both
  meeting the predeclared 80% threshold.
- Artifact: [`training/phase5a/benchmark/test1-final-result.md`](training/phase5a/benchmark/test1-final-result.md).
- Frozen training corpus: [`training/phase5a/dataset/frozen/trial4-v3-human-183.json`](training/phase5a/dataset/frozen/trial4-v3-human-183.json).
- Canonical contract this was trained/evaluated against: [`training/phase5a/lore/task-contract.v3.md`](training/phase5a/lore/task-contract.v3.md).

**Deterministic pipeline execution** (canonical evidence → derived
metrics → patterns → minimized aggregates → LLM interpretation →
persisted claims) works end to end against real data and a real external
API.

- Artifact: [`docs/decisions/0015-t3-persona-interpretation-openrouter.md`](docs/decisions/0015-t3-persona-interpretation-openrouter.md).

## 2. Failed / falsified

**Zero-shot `Qwen3-0.6B` does not have sufficient semantic capability for
the localized edit-judgment task without specialization.**

- Broad semantic matrix: 52.9%. A/B discrimination: 51% (chance level).
  Coarse feature classification: 14.9% — below every pre-declared
  feasibility band.
- This falsifies zero-shot viability for this model class under that
  architecture. It does not falsify local/WebGPU inference generally.
- Preserved in: [`docs/history/experiments/0016-phase5a-trials-history.md`](docs/history/experiments/0016-phase5a-trials-history.md)
  ("Trial 3" section).

**Phase 5A's original evidence-representation hypothesis (semantic delta
extraction from AI-output/human-edit pairs, scored for groundedness) did
not clear its ≥80% groundedness threshold** across three controlled
trials (66.7% → 66.7% → 70.6%).

- Preserved in: [`docs/history/experiments/0016-phase5a-trials-history.md`](docs/history/experiments/0016-phase5a-trials-history.md).

## 3. Not demonstrated yet

- **Gemma 3 270M Test 2** — synthetic filtered distillation, a fresh
  held-out benchmark, and WebGPU deployment validation. Not started; no
  paid generation has run. Skeleton: [`training/test2/`](training/test2/).
- **Automatic natural-writing LEARN** — a single natural user-authored
  text → structured behavioral/preference observations. Not implemented,
  not validated. Contract: [`docs/MVP_PRODUCT_CONTRACT.md`](docs/MVP_PRODUCT_CONTRACT.md).
- **Personalized REWRITE** — frontier output + HDNA state → adapted
  expression with preserved meaning. Not implemented, not validated.
- **VERIFY as a safety gate** — the v3 judgment primitive is a candidate
  input, not a validated `VERIFY` implementation.
- **The complete MVP product loop** (capture → LEARN → aggregated state
  → REWRITE → VERIFY → adapted response). Not implemented.
- **Production-ready judgment quality or reliable dimension prediction**
  — Test 1's dimension axis (the 15-value observable-behavior taxonomy)
  remained the main weakness: false-positive dimensions, missed
  dimensions, and boundary confusion were common. See
  [`training/phase5a/benchmark/test1-final-result.md`](training/phase5a/benchmark/test1-final-result.md)'s
  "What Test 1 did NOT prove" section.
- **A statistically precise accuracy estimate** — Test 1's final
  validation used n=10 (the originally planned close was n=20; the
  reduction to n=10 is a documented protocol deviation), which is a
  feasibility signal, not a production-quality certification.
