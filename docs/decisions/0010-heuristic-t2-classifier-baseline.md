# 0010 — Phase 3C: heuristic T2 classifier baseline, formality + directness only

## Decision

Ship the first two T2 derived dimensions (formality, directness) using a
deterministic, lexicon/heuristic-based `HeuristicTinyClassifier` behind a
`TinyClassifier` interface, rather than a real trained classifier model —
the same split as embeddings (`docs/decisions/0009`). All seven T2
dimensions from the doc are typed in `T2_DIMENSION_STATUS`
(`spec/schema/t2-dimensions.ts`), but only formality and directness are
`MVP_REQUIRED`; the other five (warmth, assertiveness, politeness,
emotional intensity, sarcasm likelihood) are `SPEC_RESERVED` — typed, never
computed, not stubbed with fabricated values.

Every score carries per-dimension confidence and extractor id/version
(`TraitScoreRecord`), matching the doc's "derived feature" metadata
requirement exactly. Confidence is folded into aggregation: `T2Profile`
tracks a confidence-weighted running mean per dimension (`applyTraitScore()`),
not a plain average — a low-confidence observation (e.g. a very short text)
moves the mean less than a high-confidence one.

The engineering effort went into the classifier/rebuild/aggregation
contract, reusing established patterns rather than inventing new ones:
- **Idempotency + atomicity**: `TraitClassifierService.classifyOne()` uses
  the exact same pattern as `edit-event-processor.ts`
  (`docs/decisions/0007`) — a `profileAppliedAt` receipt on
  `TraitScoreRecord`, with the trait-score write and profile-aggregate
  write landing atomically via `StorageAdapter.putMany()`.
- **Rebuild contract**: `TraitClassifierService.rebuild()` mirrors
  `VectorIndexService.rebuild()` (`docs/decisions/0009`) — discards
  existing trait scores/profile and recomputes from every registered
  canonical evidence source. Directly reuses the same `EmbeddingSource`
  adapters (`writingSampleSource`, `editEventSource`) rather than
  duplicating source-mapping logic.
- **Job wiring**: `classify_evidence` at `P2` (incremental), `rebuild_t2_profile`
  at `P3` (expensive/rare) — same priority split as the embedding jobs.

## Why the decision was made

Operator's explicit framing, mirroring the embeddings decision: treat all
seven T2 dimensions as derived estimates with confidence/support, but only
implement the two with the clearest deterministic signal in this round —
formality (word length, contraction rate, emoji rate, exclamation rate) and
directness (hedge-phrase frequency). The operator specifically flagged that
sarcasm needs conservative handling a simple heuristic can't provide, so it
stays unimplemented rather than getting a low-quality heuristic that would
misrepresent confidence.

## Alternatives considered

1. A real trained tiny classifier (e.g. a small sentiment/style model via
   transformers.js) — rejected for this PR, same reasoning as embeddings: a
   new model dependency, execution context, and testing approach bundled
   into a scope decision that should stay separate.
2. All seven dimensions with heuristics now — rejected: warmth,
   assertiveness, politeness, emotional intensity, and sarcasm likelihood
   are much harder to score reliably with simple lexical rules; shipping
   them now risks presenting noise as signal under the same confidence
   framework that's supposed to distinguish reliable from unreliable
   observations.
3. Plain (unweighted) mean aggregation instead of confidence-weighted —
   rejected: the doc's derived-feature contract explicitly calls for
   confidence to matter, and the project already has this exact
   incremental-update pattern (`applyEditMetrics`) to build on.

## Research/evidence used

Not applicable — the heuristics are explicit, documented, non-validated
approximations, not claims backed by research. (Contrast with the doc's
`docs/research/references.md` stylometry entries, which are `SUPPORTED`
claims about measurable signals; formality/directness-from-heuristics here
makes no such claim.)

## What the AI system was asked to evaluate

Operator specified the direction (heuristic baseline, strict interface,
confidence/support tracking, formality+directness only, conservative sarcasm
handling) directly. Implemented: the `TinyClassifier`/`TraitScoreRecord`/
`T2Profile` schema shapes, the confidence-weighted incremental aggregation
function, the specific formality/directness heuristics (documented as crude
approximations in code comments), and reused the exact idempotency/rebuild
patterns from Phase 2/3B rather than re-deriving them.

## Known limitations

- Heuristics are crude and explicitly not validated against any ground
  truth — e.g. formality's word-length signal is a common but weak
  stylometric proxy, not a measured claim.
- Confidence is derived only from word count (saturating at 20 words); it
  doesn't account for text genre, language, or other factors that would
  affect heuristic reliability.
- No UI resolution from a low sample count / low confidence state to a
  user-facing "not enough data yet" distinction beyond what the raw numbers
  show.

## Current validation status

Implemented and tested:
- `spec/schema/t2-dimensions.ts`, `spec/schema/trait-score.ts`,
  `spec/schema/t2-profile.ts`, `spec/protocol/tiny-classifier.ts`.
- `extension/src/persona/t2-classifier.ts` — 10 tests (empty-text handling,
  relative ordering of informal-vs-formal and hedged-vs-direct text,
  confidence scaling with word count, determinism, and an assertion that
  `HeuristicTinyClassifier.classify()` populates only the `MVP_REQUIRED`
  dimensions per `T2_DIMENSION_STATUS`, mirroring the `ExpressionSheet`
  field-status test pattern from `docs/decisions/0004`).
- `extension/src/persona/t2-profile.ts` (`applyTraitScore`) — 6 tests,
  including exact confidence-weighted-mean verification against manual
  calculation.
- `extension/src/persona/trait-score-store.ts` /
  `extension/src/persona/t2-profile-store.ts` — 9 tests, `DERIVED` class.
- `extension/src/persona/trait-classifier-service.ts` — 5 tests: idempotent
  double-run, pre-seeded-receipt no-op, rebuild discards stale data and
  recomputes from every source.
- `extension/src/queue/processors/trait-classification-jobs.ts` — 4 tests
  confirming P2/P3 priorities and correct execution.
- 176/176 tests pass (34 new), clean typecheck, clean build (96.5 KB total).
