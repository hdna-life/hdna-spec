# Test 2 acceptance criteria (frozen)

Written before any Test 2 output exists. Test 2 is a feasibility/
deployment gate, not production certification — see
`docs/MVP_PRODUCT_CONTRACT.md`.

## Primary gate

- Semantic verdict exact accuracy: **PASS >= 80%** (same standard Test 1 used).

## Additional required gates

All of these must also pass — "additional," not optional:

- Human acceptable rate: PASS >= 80%.
- Schema-valid output rate: PASS >= 98%. Malformed model output counts
  against this rate; a transport failure does not (reported separately,
  never counted as a semantic or schema error).
- Dimension micro-F1: PASS >= 0.60. Test 1 showed the dimension axis is
  much harder than the verdict axis — this is a required gate, but a
  looser one than the primary gate; dimension exact-set accuracy is
  never itself a PASS/FAIL gate.
- Browser/WebGPU deployment succeeds (see below).

## Reported diagnostics (not gates)

- Dimension exact-set accuracy.
- Per-dimension precision/recall/F1.
- Confusion around the named boundary pairs in `coverage-plan.v1.json`.

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

- semantic exact gate passes (primary)
- human acceptable gate passes (required)
- schema validity gate passes (required)
- dimension micro-F1 gate passes (required)
- browser/WebGPU deployment succeeds (required)

**A Test 2 PASS still does not prove the complete LEARN/REWRITE product
loop.** It proves the narrow question in `training/test2/README.md`.
