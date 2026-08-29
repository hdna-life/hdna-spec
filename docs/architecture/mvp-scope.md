# MVP Scope Classification

Classifies every capability in this codebase against **current product
reality** — see `docs/CURRENT_STATE.md` for the status narrative and
`docs/MVP_PRODUCT_CONTRACT.md` for the product contract this
classification is measured against. This is not a call-graph audit or a
deletion plan; nothing is removed by this classification alone.

## PRODUCT FOUNDATION — reusable and retained

Infrastructure the product still needs regardless of the LEARN/REWRITE
redesign:

- MV3 extension runtime (WXT + Svelte), background service worker,
  Dashboard/popup.
- `StorageAdapter` (IndexedDB-backed), storage-class taxonomy
  (`CANONICAL`/`DERIVED`/`CACHE`/`RAW`), eviction primitives.
- Persistent job queue (`P0`-`P3`, survives SW termination), resource
  governor, runtime controls/status.
- Deterministic revision localization/diff primitives
  (`revision-diff.ts`, `revision-intervention.ts`) — still valuable for
  a future `<VERIFY>` implementation, which compares two texts the same
  way.
- The canonical v3 semantic/behavior judgment contract
  (`training/phase5a/lore/task-contract.v3.md` +
  `policy-spec.v1.json`) and its runtime validation
  (`behavior-dimension.ts`).
- Deterministic test infrastructure (vitest + fake-indexeddb; Python
  `unittest` for training tooling).

## VALIDATED RESEARCH / EVALUATION TOOLING

Retained because Test 2 depends on it, or because it is evidence:

- Test 1's Qwen3-0.6B specialization result and its frozen dataset
  (`training/phase5a/dataset/frozen/`).
- `SemanticRevisionJudgeProvider` and both transports (local MLX,
  OpenRouter reference).
- `Trial4BenchmarkService` and the Dashboard's Benchmark page — blind
  A/B/C evaluation tooling Test 2 reuses.
- `training/phase5a/`'s generate/review/train pipeline (Test 1's closed
  workflow, kept for reproducibility) and `training/test2/`'s pipeline
  (Test 2's active workflow).

## SUPERSEDED EXPERIMENTAL RUNTIME

Implemented, tested, and were the product hypothesis at the time — no
longer the current MVP direction. Not deleted in this pass; classified
here so they are not read as current product architecture:

- `EditEvent`/`EditMetrics`/`EditProfile` (AI-output/human-edit pair
  capture) — the product's learning source is natural user writing, not
  edit pairs.
- `HashingEmbeddingProvider`/`VectorIndexService` — non-semantic
  baseline, no current product consumer.
- `HeuristicTinyClassifier`/`T2Profile` — heuristic precursor to what
  `<LEARN>` is meant to do.
- `PatternCompilerService`/`PatternStore`.
- `PersonaInterpreterService`/`OpenRouterPersonaInterpreter`/
  `TraitBeliefClaim` (T3) — superseded by a local `<LEARN>` model.
- `SemanticDeltaExtractorProvider`/`OpenRouterSemanticDeltaExtractor`
  (Phase 5A) — its groundedness hypothesis did not clear threshold; not
  pursued further.
- The manual edit-pair learning flow generally, and `ExpressionSheet`
  where it represents that flow rather than the new LEARN-based state.

## TEST 2 — REQUIRED BEFORE PRODUCT IMPLEMENTATION

Narrow feasibility/deployment gate: can `google/gemma-3-270m-it`, after
synthetic filtered distillation, retain acceptable quality on the v3
judgment primitive AND run as the intended browser/WebGPU-class model?
Frozen criteria: `training/test2/ACCEPTANCE_CRITERIA.md`. Does not
validate the LEARN/REWRITE loop. Status: pipeline implemented and
offline-tested; no generation has run; no paid API calls made.

## PRODUCT MVP — PLANNED AFTER TEST 2 PASS

```
natural writing -> local LEARN -> structured state
                    -> deterministic confidence/recency aggregation

frontier output -> REWRITE -> VERIFY -> fallback to original on failure
```

Full contract: `docs/MVP_PRODUCT_CONTRACT.md`. Not started — implemented
as normal product work once Test 2 passes, not as another research phase.

## SPEC_RESERVED — typed, not implemented

- `GovernorSignals.webgpuContention`/`.batteryLevel`/`.memoryPressure` —
  typed for a stable signature; unwired.
- `ExpressionSheet.prosody`/`.gestureProfile`/`.formality`/`.directness`/
  `.warmth` — tagged `SPEC_RESERVED`, unpopulated; superseded by the
  MVP contract's own learned-state shape rather than being completed.
- `T2Dimension`'s five reserved dimensions — unpopulated, superseded by
  the same.
- `.hdna` manifest shape (`spec/hdna-format/manifest.ts`) — typing only.

## Other deferred work

- Live/content-script capture at scale, character n-grams, keystroke/
  session telemetry — superseded by the LEARN-based capture direction;
  any future capture work should target that, not the old edit-pair flow.
- A real neural embedding provider, a trained T2 classifier, a non-
  OpenRouter persona interpreter — orphaned by the SUPERSEDED section
  above; not being completed.
- Multimodal activation, export/publish/self-host runtime — unstarted,
  unaffected by this pass.
