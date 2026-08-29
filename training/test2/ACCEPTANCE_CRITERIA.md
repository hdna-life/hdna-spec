# Test 2 acceptance criteria (frozen)

Written before any Test 2 output exists. Test 2 is a feasibility/
deployment gate, not production certification — see
`docs/MVP_PRODUCT_CONTRACT.md`.

## Primary model quality gate

- Semantic verdict exact accuracy: **PASS >= 80%** (same standard Test 1 used).

## Secondary quality

- Human acceptable rate: PASS >= 80%.
- Schema-valid output rate: PASS >= 98%.
- Provider/runtime failure rate: reported separately, never counted as a
  semantic error. Malformed model output counts against schema-valid rate;
  a transport failure does not.

## Dimension quality (secondary, not the main gate)

Test 1 showed the dimension axis remains much harder — exact-set accuracy
is not the pass gate here.

- Dimension micro-F1: **PASS >= 0.60**.
- Also report: dimension exact-set accuracy, per-dimension precision/
  recall/F1, and confusion around the named boundary pairs in
  `coverage-plan.v1.json`.

## Fresh benchmark

- n >= 100 fresh, untouched cases.
- Must not come from Test 1's benchmark, must not be used in generation,
  verifier examples, or targeted retry/fix prompts.
- Ground truth locked before model outputs are scored.
- Checked against `benchmark/protected-cases.v1.json` before any use.

## WebGPU deployment gate

A training PASS alone is insufficient. Require, in a supported Chromium
browser on the target machine:

- the intended quantized/deployment artifact loads
- WebGPU execution succeeds
- schema-valid inference succeeds on a small smoke set
- no mandatory server-side inference for the tested path

Record (measurements only, never invent numbers before running):
artifact format, artifact size, browser/version, GPU, first load time,
cached load time, p50/p95 inference latency, schema-valid rate,
runtime/load failures. No latency PASS threshold is set — report it as an
engineering measurement, not a hard research gate.

## Overall Test 2 PASS

All of:

- semantic exact gate passes
- human acceptable gate passes
- schema validity gate passes
- dimension micro-F1 secondary gate passes
- browser/WebGPU deployment succeeds

**A Test 2 PASS still does not prove the complete LEARN/REWRITE product
loop.** It proves the narrow question in `training/test2/README.md`.
