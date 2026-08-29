# Test 2 — synthetic filtered distillation

Status: **pipeline implemented, offline-tested. No API calls have been
made. No generation has run.**

Narrow question: can `google/gemma-3-270m-it`, after clean synthetic
filtered distillation, retain acceptable quality on the canonical v3
judgment primitive (`training/phase5a/lore/task-contract.v3.md`) AND run
as the intended browser/WebGPU-class model? Frozen pass/fail criteria:
[`ACCEPTANCE_CRITERIA.md`](ACCEPTANCE_CRITERIA.md). Test 2 does not
validate the complete LEARN/REWRITE product loop — see
`docs/MVP_PRODUCT_CONTRACT.md`.

## Pipeline

```
coverage plan
-> generate.py     (generator proposes; proposal is never ground truth)
-> validate.py     (deterministic schema/policy validation)
-> verify.py       (blind verifier judgment + v1 acceptance policy)
-> dedupe.py       (exact dedup, then semantic near-dedup if configured)
-> build_dataset.py (contamination guard, coverage quotas, freeze, manifest)
```

Each stage reads the previous stage's output JSONL and appends to its own
— already-processed IDs are skipped, and stage output survives
interruption. Rejections are recorded with a reason in
`data/failures/<stage>.jsonl`, never silently dropped.

## Generator/verifier roles (v1 acceptance policy)

The generator proposes a candidate (input pair + verdict + dimensions).
The verifier is blind to the generator's proposal — it sees only
`kind`/`originalText`/`finalText`/`beforeContext`/`afterContext` and
returns its own independent verdict, dimensions, and confidence.

A candidate is accepted only if the verifier's verdict agrees with the
generator's proposed verdict AND verifier confidence >= 0.90. Dimension
**sets** are not required to match exactly — a disagreement there is
recorded (`dimension_sets_equal`) for later auditing, not a rejection
reason. On acceptance, the **verifier's** verdict and dimensions become
the canonical training target, never the generator's.

No adjudicator in v1. If verifier quality proves insufficient during a
small smoke run, stop and revise this policy rather than adding a
stronger adjudication chain silently.

## Coverage

`coverage-plan.v1.json` is a frozen, predeclared generation plan — bucket
quotas, verdict bands, operation minimums, language mix — covering the
taxonomy boundaries that were weak or ambiguous in Test 1.

## Contamination guard

`benchmark/protected-cases.v1.json` stores content-hashes only, never raw
text. `build_dataset.py` rejects any candidate whose (original, final)
pair hash matches a protected entry before freezing the corpus. Populate
it via `pipeline/add_protected_case.py` (local text in, hash out — the
text itself is never written to this repository).

## Dedup

Exact normalized dedup always runs. Semantic near-dedup requires an
explicitly configured embedding provider (a separate choice from the
runtime's non-semantic `HashingEmbeddingProvider`) and fails closed —
with none configured, near-duplicates are left in place rather than
approximated with a non-semantic method.

## Offline testing

`tests/test_pipeline_e2e.py` runs the entire pipeline end to end with
mock generator/verifier fixtures — no network. Run:

```bash
python3 -m unittest training.test2.tests.test_pipeline_e2e -v
```

CI runs this on every push; it requires no secrets or network access.

## Constraints

- Do not reuse Test 1's benchmark cases as Test 2 training or evaluation
  input.
- No paid generation has started. `generate.py --provider openrouter` /
  `verify.py --provider openrouter` both refuse to run — the real prompts
  are not authored yet.
- A completed training run is not sufficient to call the WebGPU target
  validated — see `benchmark/README.md`'s required smoke-test checklist.

## Structure

```
training/test2/
  README.md
  ACCEPTANCE_CRITERIA.md
  coverage-plan.v1.json
  lib/                shared modules (ids, jsonl_io, providers, dedup,
                       contamination, coverage, acceptance, manifest)
  pipeline/            the five stage scripts + add_protected_case.py
  tests/               offline end-to-end pipeline test
  data/                generated/accepted corpus (gitignored)
  benchmark/
    README.md            WebGPU deployment validation checklist
    protected-cases.v1.json  contamination-guard hash registry
  manifests/           per-run manifests
```
