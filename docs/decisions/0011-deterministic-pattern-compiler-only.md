# 0011 — Phase 4: deterministic PATTERNS layer only, no LLM/model call

## Decision

Implement only the deterministic half of the design doc's persona-compiler
pipeline (EVENTS → **PATTERNS** → ~~TRAITS/BELIEFS~~): `PatternCompilerService`
aggregates existing derived evidence (`EditMetrics`, `TraitScoreRecord`) into
context-scoped `Pattern` records, gated by an explicit evidence threshold
(`PatternCompilerPolicy`). The TRAITS/BELIEFS step — the doc's own "T3: rare
persona-model interpretation," which requires an actual LLM call on
aggregated evidence — is **not implemented**. No provider abstraction, no API
keys, no network permission, no placeholder/stub model call was added in
this PR; that remains its own future decision.

Patterns are genuinely context-scoped, not a re-wrap of the existing global
`EditProfile`/`T2Profile` singletons: each observation's context bucket is
resolved from its source evidence's `context.surface`
(`WritingSample`/`EditEvent`), defaulting to `"unscoped"` when absent. This
matches the doc's own example (`risk_tolerance` differing between
`software_experimentation` and `personal_finance`) rather than only
supporting a single flattened aggregate.

Reused patterns rather than inventing new ones:
- **Evidence thresholds / deterministic triggers**: `aggregateObservations()`
  is a pure function that emits a `Pattern` only once both `minSampleCount`
  and `minConfidenceWeight` are crossed — directly implementing the doc's
  "yeterli değilse hiçbir [pattern] yapılmaz" rule, one layer below where the
  doc originally states it (trait inference), since this PR stops one layer
  earlier.
- **Confidence weighting**: same weighted-mean approach as
  `applyTraitScore()` (0010) — a low-confidence observation (e.g. a
  deterministic diff metric, confidence 1, vs. a heuristic classifier score,
  confidence scaled by evidence length) moves the aggregate proportionally.
- **Rebuild contract**: `PatternCompilerService.compile()` discards existing
  patterns and recomputes from scratch, mirroring `VectorIndexService.rebuild()`
  (0009) and `TraitClassifierService.rebuild()` (0010) — patterns are
  derived, never a store of record.
- **Job wiring**: `compile_patterns` at `P3` (expensive/rare, per the doc's
  explicit "compiler job runs as expensive/low-priority background work"),
  manually triggered from the popup — same UX pattern as the vector-index
  rebuild button.

## Why the decision was made

Operator's explicit framing: the PATTERNS step is fully deterministic and
should be proven on its own before any model-dependent step is added. Real
LLM-based trait/belief generation is a materially different category of
dependency than anything shipped so far — network access, API key handling,
cost, and non-deterministic output — and deserves its own explicit
model/provider decision, the same way embeddings (0009) and classifiers
(0010) did, except larger: this would be the project's first network
dependency of any kind.

## Alternatives considered

1. Include real LLM-based trait/belief generation now — rejected: bundles a
   provider decision, credential/network handling, and a fundamentally
   different testing approach into a PR that doesn't need any of that to
   deliver working value.
2. A stub/mock TRAITS interface with fake data or a "not implemented" no-op
   — rejected: not requested, and would add SPEC_RESERVED-adjacent surface
   area without a real implementation behind it, which the project's own
   MVP-scope discipline argues against (don't build to a hypothetical
   interface prematurely).
3. Reuse the existing global `EditProfile`/`T2Profile` aggregates directly as
   "patterns" instead of building genuine context-scoped aggregation —
   rejected: doesn't match the doc's PATTERN definition (contextual,
   probabilistic) and the operator's explicit ask for context-scoped
   compilation with provenance.

## Research/evidence used

Not applicable — this is architecture/scope-boundary work implementing the
doc's own stated compiler requirements, not a claim requiring external
literature support.

## What the AI system was asked to evaluate

Operator specified the boundary directly (deterministic PATTERNS only,
context-scoped, thresholds/triggers, support/confidence, provenance,
compiler versioning, no provider abstractions). Implemented: the
`Pattern`/`PatternCompilerPolicy` schema, the pure threshold-gated
aggregation function, context resolution from existing evidence records
(added `WritingSampleStore.get()`, mirroring `EditEventStore.get()`, since
it didn't exist yet), and reused the idempotency-free rebuild pattern since
pattern compilation, unlike per-event classification, aggregates across all
evidence at once rather than incrementally.

## Known limitations

- No UI currently sets `context.surface` on writing samples or edit events
  (`Onboarding.svelte`/`EditCapture.svelte` don't collect it), so in
  practice every observation currently falls into the `"unscoped"` bucket.
  The context-scoping architecture is correct and tested, just not yet
  observably differentiated by real multi-context data — a UI gap, not an
  architecture gap.
- Pattern dimensions are limited to what `EditMetrics`/`TraitScoreRecord`
  already expose (`compressionRatio`, `lexicalOverlap`, `formality`,
  `directness`) — `editDistance` and `sentenceCountChange` were excluded as
  unbounded/context-dependent raw counts, less meaningful as cross-context
  comparable pattern values than the bounded ratio/score dimensions.
- `compile()` is a full rebuild, not incremental — acceptable per the doc's
  own "expensive/low-priority background work" classification for this job
  class, unlike the P1/P2 incremental jobs elsewhere in the codebase.

## Current validation status

Implemented and tested:
- `spec/schema/pattern.ts`, `spec/schema/pattern-compiler-policy.ts`.
- `extension/src/persona/pattern-compiler.ts` (`aggregateObservations`) — 9
  tests: threshold gating (sample count, confidence weight), weighted-mean
  correctness, per-context and per-dimension grouping, supporting-evidence
  ids, compiler identity stamping, empty input.
- `extension/src/persona/pattern-store.ts` — 5 tests, `DERIVED` class.
- `extension/src/persona/pattern-compiler-service.ts` — 6 tests: context
  resolution from both evidence types (including the "unscoped" default),
  threshold enforcement end-to-end, stale-pattern discard on recompile,
  supporting-record-id provenance.
- `extension/src/queue/processors/pattern-compilation-job.ts` — 2 tests
  confirming `P3` priority and correct execution.
- `WritingSampleStore.get()` — 2 new tests in the existing test file.
- 200/200 tests pass (26 new), clean typecheck, clean build (100.8 KB).
