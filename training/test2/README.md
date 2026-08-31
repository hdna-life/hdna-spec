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

### Populating the registry with Test 1's 10 final held-out cases

Keep the 10 Test 1 pairs in a local file (JSON array or JSONL, each entry
`{"originalText": ..., "finalText": ...}`) **outside this repository** —
this tool only ever reads it, never copies or commits it:

```bash
python3 training/test2/pipeline/add_protected_case.py \
  --pairs-file /path/outside/repo/test1-final-10-pairs.json
```

For a single ad-hoc case (e.g. one of Test 2's own held-out cases):

```bash
python3 training/test2/pipeline/add_protected_case.py \
  --original-text "..." --final-text "..."
```

Both modes are idempotent — re-adding an already-present pair does not
create a duplicate registry entry. Only the sha256 content hash is ever
written to `protected-cases.v1.json`.

### Verifying readiness before any real smoke/full generation

```bash
python3 training/test2/pipeline/check_protected_registry.py
```

Exits `0` (`READY`) only if the registry has valid v1 schema, every entry
is a well-formed sha256 hash, and at least 10 *unique* hashes are present
(duplicates are never double-counted). Exits `1` (`NOT READY`) otherwise
— run this before `smoke.py` or any future `full_run.py` invocation.

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

Every real (`--provider openrouter`) run requires `--budget-requests`.
`--max-budget-usd`, if set, requires a non-zero `--max-cost-per-request-usd`
— a conservative, predeclared worst-case per-request cost. That worst
case is *reserved* before every request (`reserved_spend + max_cost_per_
request_usd <= max_budget_usd`, checked BEFORE the request, not after);
the actual provider-reported cost (when OpenRouter returns one) is
recorded separately for provenance only and never loosens the
pre-request check — a cheaper-than-estimated actual cost never unlocks
an extra request, and a more-expensive-than-estimated one never
retroactively becomes unsafe. Reserved and actual generator/verifier
spend are both recorded in the run manifest.

## Smoke run (20-50 real candidates)

`pipeline/smoke.py` runs the real pipeline end to end — round-robin
generator (explicit per-request language routing) -> validate ->
contamination guard -> blind verifier -> exact dedup -> contamination
guard again (defense in depth) — on a small candidate count, writing a
smoke manifest with full diagnostics. It never builds/freezes the final
corpus, trains anything, or touches acceptance thresholds/coverage
quotas/the final benchmark.

Every run is isolated under `data/smoke/<run-id>/`; a new `--run-id`
never touches another run's artifacts. Re-running the same `--run-id`
**resumes** it and is fully cumulative:

- `--max-candidates` is the TOTAL for that run_id across every
  invocation, not "more, again" — a resume only generates the shortfall.
- The budget (requests, reserved spend, actual spend, shared between
  generator and verifier) is persisted and restored, never reset by a
  restart.
- The run's model IDs, coverage plan, policy spec, token/confidence
  settings, budget configuration, and protected-registry override mode
  are persisted at creation (`run_config.json`) and a resume is
  **refused** if the requested configuration differs.
- Diagnostics in the smoke manifest are always rebuilt from the run's
  full accumulated artifacts, so they describe the whole run_id, not
  just the latest invocation.

The generator and verifier refuse to start if `benchmark/protected-cases.v1.json`
is still empty, unless `--allow-empty-protected-registry-smoke-only` is
passed deliberately (recorded in the manifest; never honored by the full
build — see `pipeline/full_run.py`).

```bash
export OPENROUTER_API_KEY=sk-or-...
python3 pipeline/smoke.py --run-id smoke-001 \
  --generator-model-id <model> --verifier-model-id <model> \
  --max-candidates 30 --generator-budget-requests 35 --verifier-budget-requests 35 \
  --max-budget-usd 1.00 --max-cost-per-request-usd 0.01
python3 pipeline/review_smoke.py data/smoke/smoke-001/smoke-001.smoke_manifest.json
```

`review_smoke.py` prints the diagnostics for a human STOP/REVISE-vs-
PROCEED call — it never decides this itself.

## Full run (later, not executed by this pass)

`pipeline/full_run.py` is the canonical orchestration entrypoint for the
eventual 5K-accepted-example generation: generate -> validate ->
contamination guard -> blind verifier -> acceptance -> exact dedup ->
semantic near-dedup -> contamination guard again -> `build_dataset.py`'s
quota/band/language enforcement -> frozen dataset. Its
`replenish_to_accepted_quota()` treats each coverage bucket's quota as a
target for **accepted** examples, not generated candidates: it keeps
generating for a bucket — replenishing whatever schema rejection,
verifier disagreement, low confidence, provider failure, exact/semantic
dedup, or contamination removed — until that bucket's accepted count
meets its frozen quota, an explicit `max_total_requests` ceiling is
reached, or every still-short bucket hits its own
`max_attempts_per_bucket` ceiling. There are no built-in large defaults
for either ceiling — a real full run must pass them explicitly. Hitting
a ceiling before every quota is met stops safely, preserves progress,
and reports the shortfall; it never freezes a corpus with missing
quotas (`build_dataset.py` refuses that unconditionally). Unlike smoke,
full-run generation requires a populated protected-case registry with no
override, and semantic near-dedup requires an explicitly configured
embedding provider — this module does not pick one.

## Offline testing

`tests/test_pipeline_e2e.py` runs the entire pipeline end to end with
mock generator/verifier fixtures — no network. `tests/test_protected_registry.py`
covers the protected-case registry's hashing/validation contract and its
CLIs. Run:

```bash
python3 -m unittest training.test2.tests.test_pipeline_e2e -v
python3 -m unittest training.test2.tests.test_protected_registry -v
```

CI runs this on every push; it requires no secrets or network access.

## Constraints

- Do not reuse Test 1's benchmark cases as Test 2 training or evaluation
  input. `benchmark/protected-cases.v1.json` guards this — populate it via
  `pipeline/add_protected_case.py --pairs-file` before generating, and
  verify with `pipeline/check_protected_registry.py`.
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
  lib/                shared modules (ids, jsonl_io, providers, real_providers,
                       dedup, contamination, coverage, acceptance, budget,
                       run_state, manifest, smoke_report, protected_registry)
  pipeline/            the five stage scripts + smoke.py + full_run.py +
                       review_smoke.py + add_protected_case.py +
                       check_protected_registry.py
  tests/               offline end-to-end pipeline test + protected-registry test
  data/                generated/accepted corpus (gitignored)
  benchmark/
    README.md            WebGPU deployment validation checklist
    protected-cases.v1.json  contamination-guard hash registry
  manifests/           per-run manifests
```
