# Test 2 benchmark

A completely fresh held-out set — never Test 1's benchmark cases, never
anything used in Test 2 generation/verification.

## WebGPU deployment validation (required)

A successful training run is not sufficient to call the WebGPU target
validated. The final Test 2 report must include an actual browser/WebGPU
smoke test using the quantized/deployment artifact intended for the MVP.

Checklist — fill in real measurements only, never fabricate:

- [ ] Deployment format:
- [ ] Artifact size:
- [ ] Browser/WebGPU tested (browser + version, GPU):
- [ ] First load time:
- [ ] Cached load time:
- [ ] Inference latency (p50 / p95):
- [ ] Schema-valid output rate:
- [ ] Runtime/load failures observed:

No numbers exist yet. This section is a placeholder checklist, not a
result.
