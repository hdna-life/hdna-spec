# Phase 5A Trial 4 — Test 1 Smoke Iteration 1

**Status:** frozen smoke-test artifact. Do not modify or reinterpret these
results after the fact (see "Methodology rule" at the end of this file).
This is a documentation-only record — no training data, adapter weights,
benchmark results, or evaluation code were changed to produce or in
writing this report.

**Result in one line:** specialization signal is POSITIVE (trained Qwen
beat base Qwen on every reported axis); the full Test 1 result is
**NOT YET VALID / NOT YET CONCLUSIVE** — this run is a smoke test, not a
pass/fail iteration.

## Experiment setup

**Goal:** test whether LoRA specialization makes the same Qwen3-0.6B base
model a better v3 localized-edit judge.

**Student/base:** `Qwen/Qwen3-0.6B`

**Trained model:** the same `Qwen/Qwen3-0.6B` + a LoRA adapter trained on
the frozen 183-example human-reviewed v3 dataset.

**Local inference:**
- Base Qwen: `localhost:8080`
- Trained Qwen: `localhost:8081`

**Frontier reference:** `deepseek/deepseek-v4-flash-0731` via OpenRouter.
DeepSeek is a reference only, not the success condition.

**Benchmark corpus:**
- 10 fresh Turkish held-out cases
- not intentionally copied from or highly similar to the 183 training
  examples
- human ground truth locked before seeing any model output
- model identities blinded as A/B/C
- human then marked each response Acceptable/Unacceptable and ranked the
  acceptable ones

**Prompt/contract check:** the runtime/training prompt contract was
checked during debugging. The benchmark uses the v3 four-field task
(`verdict`, `dimensions`, `description`, `confidence`) with the same
two-question semantic-vs-behavioral framing used during training — Base
and Trained receive the identical prompt; DeepSeek uses the equivalent
schema via OpenRouter structured output.

## Bugs / infra issues found during the smoke test

1. **Qwen/MLX transport token.** Qwen/MLX sometimes appends `<|im_end|>`
   after otherwise-valid JSON, which initially caused valid JSON to fail
   parsing. Fixed with a narrow transport normalization: strip only the
   exact trailing Qwen transport token before Markdown-fence/JSON parsing.
   No generic JSON recovery was added.

2. **Base Qwen frequently produced schema-invalid responses** — e.g.
   missing required fields such as `confidence`. This is **not**
   automatically an infrastructure bug: if the server returned a response
   but the model violated the required schema, that is a model/task
   failure and must remain visible as such, not folded into "the server
   was down."

3. **A separate `Failed to fetch` case was observed.** This IS a
   transport/infrastructure failure and must not be conflated with a
   model schema failure (see item 2).

4. **Aggregate stats currently group transport failures and
   malformed/schema-invalid model outputs too loosely under "provider
   errors."** This prevents clean interpretation of the primary metric —
   see "Next iteration" below.

5. **Invalid dimension-direction combinations were observed in model
   output**, e.g.:
   - `factual_content -> increased`
   - `expressed_affect_valence -> decreased`
   - `expressed_affect_intensity -> more_negative`

   The canonical v3 contract does not allow these. Strict
   dimension-direction validation must be verified to apply identically to
   ALL benchmark providers, including OpenRouter/DeepSeek, before the next
   formal iteration.

## Smoke results

Aggregate UI after the 10-case run:

| Metric | Trained Qwen | DeepSeek (frontier ref.) | Base Qwen |
|---|---|---|---|
| Semantic exact accuracy | 56% | 89% | not meaningfully reported |
| Dimension exact-set accuracy | 22% | 11% | not meaningfully reported |
| Dimension micro-F1 | 0.43 | 0.58 | not meaningfully reported |
| Human acceptable rate | 67% (6/9) | 100% (9/9) | 0/0 |
| Rank-1 | 3/9 (33%) | 7/9 (78%) | — |
| Provider errors | 1 | 1 | 10 |

**Do not interpret the Base row as a valid trained-vs-base quantitative
comparison yet** — the current scorer/error taxonomy does not distinguish
model schema failure from infrastructure failure cleanly enough (Base's 10
provider errors could be any mix of the two; see "Bugs" items 2-4 above).

## Qualitative observations

Trained Qwen showed a positive specialization signal. It repeatedly:

- produced the required v3 schema more reliably than base
- detected semantic changes that base missed or abstained on
- sometimes matched the human semantic verdict exactly
- sometimes produced correct canonical behavioral dimensions
- produced 6/9 human-acceptable parseable responses
- won blind Rank 1 on 3/9 evaluated responses

Examples included exact or near-exact judgments for: certainty/
evidentiality changes, no-meaningful-change + specificity decrease,
action/decision changes, and conditionality/scope changes.

However:

- semantic accuracy is still below the previously proposed 60%
  "promising" line in this tiny sample
- dimensions remain noisy
- false-positive dimensions are common
- some required dimensions are missed
- 10 cases are far too few for a final conclusion

**SPECIALIZATION SIGNAL: POSITIVE**
**FULL TEST 1 RESULT: NOT YET VALID / NOT YET CONCLUSIVE**

This is not a PASS.

## Next iteration — what must be fixed first

Before running another held-out Test 1 set:

1. Split failures into at least: transport/infrastructure failure vs.
   model output/schema failure.
2. Evaluation semantics:
   - transport failure => case/run invalid for that provider; rerun or
     exclude as infrastructure failure
   - schema-invalid model response from a reachable provider => genuine
     model failure
3. Add/report TWO semantic metrics:
   - **end-to-end semantic exact accuracy** — correct / all valid
     infrastructure attempts, with schema failures counted as incorrect.
     **This is the primary Test 1 metric.**
   - **parse-conditional semantic accuracy** — correct / parseable
     valid-schema responses. Diagnostic only, never the headline number.
4. Verify canonical dimension-direction validation is enforced identically
   after every provider transport, including OpenRouter.
5. Do NOT change the prompt specifically to rescue Base Qwen. Base and
   Trained must continue receiving the same v3 prompt and the same
   inference settings — the only intended difference remains the LoRA
   weights.
6. Do NOT reuse these 10 cases as the next scored benchmark — their model
   outputs have already been inspected.

## Next test

After the evaluation plumbing above is fixed, run a NEW held-out Test 1
iteration:

- Use a larger fresh corpus than this 10-case smoke set. Recommended:
  **30 fresh cases** (suggested language mix: 18 Turkish, 12 English).
- Keep reasonable semantic/dimension coverage rather than optimizing
  examples toward the trained model's observed weaknesses.
- Ground truth must again be locked before any model output is shown.
- Predeclare the metrics and denominator rules before running models.

**The next iteration's main questions:**

1. Does Trained Qwen achieve >=60% end-to-end semantic exact accuracy?
2. Does it materially outperform Base Qwen on the identical cases?
3. Does the ~67% human-acceptable signal survive on a larger fresh set?
4. Are schema adherence and dimension F1 materially better than Base?
5. Is the signal strong enough to justify the proposed larger
   frontier-generated / independently-filtered distillation round?

## Methodology rule

Do not modify or reinterpret Iteration 1 results after observing them.
Treat this 10-case run as a frozen smoke-test artifact. Any future
training/distillation using additional synthetic data belongs to a NEW
training iteration and must be evaluated on another untouched held-out
benchmark.
