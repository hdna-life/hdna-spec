# Test 2 — synthetic filtered distillation

Status: **skeleton only. No generation has run. No API calls have been made.**

Narrow question: can `google/gemma-3-270m-it`, after clean synthetic
filtered distillation, retain acceptable quality on the canonical v3
judgment primitive (`training/phase5a/lore/task-contract.v3.md`) AND run
as the intended browser/WebGPU-class model? Test 2 does not validate the
complete LEARN/REWRITE product loop — see `docs/MVP_PRODUCT_CONTRACT.md`.

## Pipeline

```
coverage plan
-> generator candidate
-> deterministic schema validation
-> blind verifier independent judgment
-> agreement filtering
-> exact + semantic near-dedup
-> coverage balancing
-> frozen accepted corpus
-> Gemma LoRA/SFT
-> completely fresh held-out benchmark
```

Target: ~5,000 final accepted examples.

**Generator and verifier are separate roles.** The generator's proposal
(verdict, dimensions, explanation) is never ground truth. The verifier is
blind — it receives only `kind`/`originalText`/`finalText`/
`beforeContext`/`afterContext` and produces its own independent judgment
against `training/phase5a/lore/policy-spec.v1.json`, never the
generator's label, explanation, or target class. An example is accepted
only when generator and verifier agree (exact policy match).

## Coverage

`coverage-plan.v1.json` targets the taxonomy boundaries that were weak or
ambiguous in Test 1: `meaning_added` vs `meaning_transformed`, `scope` vs
`specificity`, `certainty` vs `evidentiality`/`commitment`, `politeness`
vs `directness`, `directness` vs `directive_force`, `factual_content` vs
`action_or_decision`, `conditionality`, observable expressed affect vs
inferred internal emotion, hard `no_meaningful_change` negatives, and
abstention/`uncertain` cases.

## Constraints

- Do not reuse Test 1's benchmark cases as Test 2 training or evaluation
  input — they have already been inspected.
- Do not implement or run paid generation as part of building this
  skeleton.
- A completed training run is not sufficient to call the WebGPU target
  validated — see `benchmark/README.md`'s required smoke-test checklist.

## Structure

```
training/test2/
  README.md
  coverage-plan.v1.json
  pipeline/
    generate.py       generator role — proposes candidates (stub)
    validate.py        deterministic schema/policy validation (stub)
    verify.py          blind verifier — independent judgment (stub)
    dedupe.py           exact + semantic near-dedup (stub)
    build_dataset.py    coverage balancing + freeze accepted corpus (stub)
  data/                 generated/accepted corpus lands here (gitignored)
  benchmark/
    README.md            WebGPU deployment validation checklist
  manifests/             run manifests (contract version, checksums, counts)
```
