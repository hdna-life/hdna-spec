# Phase 5A Trial 4 — Test 1 Final Result

**Status:** Test 1 is **CLOSED — SUCCESS**. This is a documentation/
experiment-closure record. No training data, adapter weights, benchmark
results, or evaluation code were changed to produce or in writing this
report. See `test1-smoke-iteration-1.md` for the earlier smoke/debug round
this final result supersedes as Test 1's answer (that round remains
documented separately, unedited, as a smoke iteration — not the final
result).

## Test 1 question

Can a very small local model learn HDNA's narrow v3 localized
edit-judgment policy through specialization?

**Base/student used in Test 1:** `Qwen/Qwen3-0.6B`

**Training:** LoRA/SFT on 183 human-reviewed v3 examples.

**Post-run caveat on the training corpus:** the 183-example dataset was
created while the annotation policy was still stabilizing. Some early
examples likely contain noisy behavioral-dimension supervision, including
labels influenced by inferred human emotion/social intent rather than
strictly observable textual behavior. This was **not** a perfectly clean
training corpus. Despite this, the trained model showed a strong learning
signal.

## Evaluation history

Test 1 used two small fresh Turkish held-out benchmark rounds.

### Round 1 — smoke/debug benchmark (not the final result)

Full record: `test1-smoke-iteration-1.md`. This round was primarily a
smoke/debug benchmark. It exposed several infrastructure and evaluation
issues, including: Qwen/MLX trailing `<|im_end|>` transport tokens,
schema-invalid base-model outputs, transport failures needing separation
from model/schema failures, benchmark UI/ground-truth workflow issues, and
canonical dimension-direction validation issues. It nevertheless showed a
positive specialization signal. Round 1 trained-model aggregate included
approximately: semantic exact 56%, human acceptable 67% (6/9), Rank-1 33%,
dimension micro-F1 0.43. **This round remains documented as a smoke/debug
iteration, not the final Test 1 result.**

### Final validation round — 10 fresh Turkish held-out cases

Ground truth was locked before model outputs were shown. Model outputs
were reviewed blind as A/B/C.

**Trained Qwen:**

| Metric | Value |
|---|---|
| Semantic exact accuracy | 80% |
| Dimension exact-set accuracy | 10% |
| Dimension micro-F1 | 0.30 |
| Human acceptable rate | 80% (8/10) |
| Rank-1 count/rate | 1/10 (10%) |
| Provider errors | 0 |

**DeepSeek (frontier reference):**

| Metric | Value |
|---|---|
| Semantic exact accuracy | 78% |
| Dimension exact-set accuracy | 11% |
| Dimension micro-F1 | 0.59 |
| Human acceptable rate | 100% (9/9) |
| Rank-1 count/rate | 8/9 (89%) |
| Provider errors | 1 |

**Base Qwen** produced schema-invalid responses frequently enough that the
Base aggregate remained unusable as a clean quantitative comparison in
this small run.

**Do not claim the trained Qwen "beat DeepSeek."** DeepSeek remained
clearly superior in qualitative richness, dimension quality, and blind
human ranking (89% Rank-1 vs. 10%). The important result is that the tiny
specialized local model reached the predeclared 80% semantic-exact target
and 80% human acceptability on the fresh final set.

## Planned 20 cases vs. actual 10 — recorded protocol deviation

Earlier Test 1 planning stated that the phase would be closed using a
20-case final benchmark. **The actual final closing validation used 10
fresh cases.** This is recorded explicitly as a protocol deviation — it is
not being rewritten to imply 10 cases was the original plan.

The smaller sample means this result is not intended as a statistically
strong estimate of production accuracy. However, Test 1's purpose was a
trainability/feasibility gate rather than final production-quality
certification. The observed result was strong enough for the operator to
consider that feasibility question answered.

**TEST 1 STATUS: SUCCESS**

**Interpretation:** the trainability hypothesis is validated. A
sub-billion-parameter local model can learn a useful version of HDNA's
narrow v3 edit-judgment policy from specialized supervision.

## What Test 1 did NOT prove

Test 1 did **not** establish:

- production-ready judgment quality
- reliable dimension prediction
- frontier-level output quality
- final model choice
- statistically precise accuracy
- that Qwen3-0.6B should be the production student

Dimension prediction remains the main weakness. Observed problems include:
false-positive dimensions, missed dimensions, boundary confusion between
related dimensions, and inconsistent canonical direction choices. The
semantic task was learned much more successfully than the full
behavioral-dimension taxonomy.

## Test 1 final conclusion

**TEST 1 — SUCCESS**

The purpose of Test 1 was to determine whether a very small local model
could acquire the HDNA judgment policy through specialization. That
question is considered answered positively.

The current Qwen3-0.6B + 183-example LoRA should now be preserved as the
Test 1 baseline. No more manual expansion of this Test 1 training corpus
is planned.

**Phase 5A Trial 4 / Test 1 is closed.**

## Direct transition to Test 2

The project will now move directly to Test 2. Test 2 changes the training
methodology: instead of manually building hundreds/thousands of examples,
create an automated synthetic distillation pipeline.

High-level Test 2 direction:

```
Policy / coverage specification
    ↓
Frontier synthetic candidate generation
    ↓
Independent frontier verification / filtering
    ↓
Schema + taxonomy validation
    ↓
Deduplication / near-duplicate rejection
    ↓
Coverage balancing / curriculum construction
    ↓
Frozen synthetic training corpus
    ↓
LoRA/SFT student training
    ↓
Completely fresh held-out benchmark
    ↓
Failure analysis
    ↓
Targeted next synthetic-data iteration
```

**Initial target:** approximately 5,000 high-quality accepted training
examples. The dataset should be deliberately targeted toward difficult
taxonomy boundaries rather than merely scaling random examples. Important
target boundaries include:

- `meaning_added` vs `meaning_transformed`
- `scope` vs `specificity`
- `certainty` vs `evidentiality`
- `certainty` vs `commitment`
- `politeness` vs `directness`
- `directness` vs `directive_force`
- `factual_content` vs `action_or_decision`
- `conditionality`
- observable expressed affect vs inferred internal emotion/psychology
- hard `no_meaningful_change` negatives
- abstention/`uncertain` cases

Human involvement moves up one abstraction level: the operator defines
policy, coverage, failure priorities, and acceptance rules. The pipeline
generates and filters the individual examples.

## Test 2 student direction

`Qwen/Qwen3-0.6B` served its purpose as the Test 1 feasibility student.
For Test 2, the planned smaller WebGPU-oriented student candidate is:

**`google/gemma-3-270m-it`**

Reason for the transition: Test 1 validated that the narrow policy is
learnable. Test 2 now asks how small/lightweight the student can become
while retaining acceptable quality after much stronger synthetic
distillation. Target runtime direction: browser, WebGPU, lightweight
quantized deployment, sufficient context for HDNA's narrow judge task.

**The Gemma migration is not implemented as part of this documentation
task** — this section only records it as the planned Test 2 student
direction.

## Experiment boundary — keep Test 1 and Test 2 cleanly separated

**Test 1:**
- Qwen3-0.6B
- 183-example partially noisy human-reviewed dataset
- feasibility/trainability validation
- **CLOSED / SUCCESS**

**Test 2:**
- synthetic filtered distillation
- ~5,000 final high-quality examples
- planned Gemma 3 270M IT student
- new training run
- completely new, untouched benchmark

**Do not reuse already-inspected Test 1 benchmark cases as Test 2's scored
held-out benchmark.**
