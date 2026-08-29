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
`dedupe.py --mode full` refuses to run without one, and
`build_dataset.py` refuses to freeze a corpus deduped without it.
`--mode smoke` explicitly allows skipping semantic dedup for the first
small paid smoke only, recording `semantic_dedup: disabled` in
`dedup_config.json`.

## Spend cap

Every real (`--provider openrouter`) run requires `--budget-requests`
(and optionally `--budget-usd`) — the pipeline stops before the next
request would exceed the cap, not after. Spend is recorded in the run
manifest.

## Smoke run (20-50 real candidates)

`pipeline/smoke.py` runs the real pipeline end to end — round-robin
generator (explicit per-request language routing) -> validate ->
contamination guard -> blind verifier -> exact dedup -> contamination
guard again (defense in depth) — on a small candidate count, writing a
smoke manifest with full diagnostics. It never builds/freezes the final
corpus, trains anything, or touches acceptance thresholds/coverage
quotas/the final benchmark.

Every run is isolated under `data/smoke/<run-id>/`; a new `--run-id`
never touches another run's artifacts, and re-running the same
`--run-id` resumes it. `--budget-usd`, if set, is a single cap shared
between the generator and verifier combined, not doubled. The generator
and verifier refuse to start if `benchmark/protected-cases.v1.json` is
still empty, unless `--allow-empty-protected-registry-smoke-only` is
passed deliberately (recorded in the manifest; never honored by the full
build).

```bash
export OPENROUTER_API_KEY=sk-or-...
python3 pipeline/smoke.py --run-id smoke-001 \
  --generator-model-id <model> --verifier-model-id <model> \
  --max-candidates 30 --generator-budget-requests 35 --verifier-budget-requests 35 \
  --budget-usd 1.00 --cost-per-request-usd 0.01
python3 pipeline/review_smoke.py data/smoke/smoke-001/smoke-001.smoke_manifest.json
```

`review_smoke.py` prints the diagnostics for a human STOP/REVISE-vs-
PROCEED call — it never decides this itself.

## Offline testing

`tests/test_pipeline_e2e.py` runs the entire pipeline end to end with
mock generator/verifier fixtures — no network. Run:

```bash
python3 -m unittest training.test2.tests.test_pipeline_e2e -v
```

CI runs this on every push; it requires no secrets or network access.

## Constraints

- Do not reuse Test 1's benchmark cases as Test 2 training or evaluation
  input. `benchmark/protected-cases.v1.json` guards this — populate it via
  `pipeline/add_protected_case.py` before generating.
- No paid generation has started; no full 5,000-example generation has
  started either — only the smoke run above is prepared.
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
