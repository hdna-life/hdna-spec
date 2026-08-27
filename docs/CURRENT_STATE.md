# CURRENT_STATE.md

Last reviewed commit: (initial commit — this PR)

## Current phase

**Phase 5A — persona evidence utility validation — is now the immediate
priority, per an explicit operator-driven roadmap change (see
`docs/decisions/0016`).** Following the first real Phase 4/T3 human dogfood
test (`docs/decisions/0015`): **PIPELINE EXECUTION is VALIDATED** (canonical
evidence → deterministic metrics → patterns → minimized aggregates →
OpenRouter → persisted claims worked end to end against the real extension
and a real external API); **PERSONA INFORMATION RICHNESS is NOT VALIDATED**
— the two deterministic dimensions PATTERNS currently produces
(`compressionRatio`, `lexicalOverlap`) don't carry enough semantic
information for T3 to construct a meaningful persona, an
information-representation bottleneck, not a sample-count problem. T3 itself
is not a failed implementation. Phase 5A (`SemanticDeltaExtractionService`,
OpenRouter-based, observation-only, per-source idempotent via receipts)
implements a new experimental evidence layer — AI-output/human-edit pairs →
grounded `SemanticDeltaCandidate` observations — to test whether richer
semantic evidence can be derived upstream of PATTERNS. **The first real run
against the 5-pair corpus is complete and human-graded: INFORMATION GAIN —
PASS (the central question), GROUNDEDNESS — FAIL (66.7% vs. required
≥80%), overall status ITERATE** — see "Current experiments / pending
decisions" below and `docs/decisions/0016` for the full result. This is
promising evidence, not proof the hypothesis is fully validated. Two
controlled follow-up trials have since targeted the groundedness shortfall
specifically: **Trial 1** (transformation-grounding instruction) —
groundedness unchanged (66.7%), still ITERATE; **Trial 2** (deterministic
evidence localization + atomic/redundancy/removal discipline) — the first
quantitative groundedness improvement (66.7% → 70.6%), still below the
≥80% threshold, still ITERATE. **Trial 3** (local semantic-revision-judge
feasibility — an architecture change, not a prompt tweak: deterministic
per-intervention judging via a tiny local `Qwen3-0.6B` model over MLX,
zero-shot, no fine-tuning) — **local runtime/MLX execution PASS, but
zero-shot semantic capability FAIL** (broad semantic matrix 52.9%, A/B
discrimination 51% — chance level, coarse feature classification 14.9%);
COMPLETE, recorded as the official zero-shot tiny-model baseline; **still
ITERATE overall** — see "Current experiments / pending decisions" below
for all three. **Phase 5A overall status remains ITERATE — not complete,
not validated.** The prior immediate roadmap (retrieval runtime → WebGPU
expression engine) is **deferred/reordered, not cancelled**, pending this
evidence-utility question — see `docs/decisions/0016`.

Phase 4's TRAITS/BELIEFS (T3) step — persona interpretation over compiled
PATTERNS via an LLM call — is now implemented (see `docs/decisions/0015`),
using OpenRouter as the concrete MVP provider behind a provider-agnostic
interface. Phase 0, Phase 1, Phase 2's first slice, and all of Phase 3
(3A/3B/3C) and Phase 4 (both the deterministic PATTERNS layer and the T3
TRAITS/BELIEFS step) are complete. This is the project's first
network/LLM dependency. Also includes a post-3C fix: `HeuristicTinyClassifier` was silently
English-only, saturating/biasing on non-English (Turkish) evidence — see
`docs/decisions/0012`. And two post-3A governor fixes on the same branch: `DEEP_IDLE` mode
selection was gated on an empty queue, which made any pending `P3` job
self-blocking (its own presence in the backlog prevented the only mode
that could dispatch it) — see `docs/decisions/0013`; then a follow-up
correction after manual testing on the real unpacked extension found that
fix's in-memory `idleTicks` counter could never accumulate across MV3
service-worker restarts, making `DEEP_IDLE` unreachable in real Chrome —
replaced with a persisted wall-clock timestamp
(`RuntimeStatus.foregroundInactiveSince`), alongside a generic
`JobQueue.enqueueSingleton()` fix for a separate bug where repeated clicks
on a rebuild button queued unbounded duplicate jobs — see
`docs/decisions/0014`. A further post-3C fix corrected the T2 panel's
"No evidence classified yet." message, which was indistinguishable from
"the classifier abstained on all evidence" — see
`docs/validation/manual-mvp-validation.md` for the full manual-testing
narrative behind 0012/0013/0014 and this fix.

## Active MVP scope

Infrastructure prerequisites for the MVP hypothesis, Phase 1 cold-start data
collection, a first Phase 2 passive-collection slice, Phase 3
(batching/eviction infra, embeddings/retrieval, and T2 classifiers), and
Phase 4's deterministic PATTERNS layer:

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`) backed by IndexedDB.
- Persistent job queue with P0-P3 priority classes, survives SW termination.
- Resource governor skeleton: pure latency/backlog-driven batch-size decisions.
- Runtime controls: pause processing vs. pause learning (distinct, persisted).
- Transparency UI: status, queue counts, storage usage by class, controls.
- Deterministic test infrastructure (vitest + fake-indexeddb), 223 tests.
- `spec/` protocol/schema types for storage classes, evidence metadata, identity
  facts, Expression Sheet, writing samples, edit events/metrics/profile,
  storage policy, embeddings, T2 dimensions/trait scores/profile, patterns,
  `.hdna` manifest shape.
- Phase 1 onboarding: real writing samples -> deterministic T0 stylometry ->
  Expression Sheet compilation, synchronous (see `docs/decisions/0004`).
- Phase 2 (first slice): AI-output/human-edit pairs, captured manually in the
  popup, processed asynchronously through the job queue (P1) -> T0 diff
  metrics -> T1 incremental profile (see `docs/decisions/0005`).
- Phase 3A: dispatch is mode-gated (INTERACTIVE/BACKGROUND/DEEP_IDLE actually
  restrict which job priorities run), foreground activity is real (popup-open
  detection via `chrome.runtime.Port`), and storage eviction (CACHE→DERIVED→RAW,
  CANONICAL never automatic) actually runs (see `docs/decisions/0008`).
- Phase 3B: `EmbeddingProvider` (execution-context-agnostic interface) +
  `HashingEmbeddingProvider` (deterministic, non-semantic baseline) +
  `VectorIndexService` (rebuildable index over canonical evidence) +
  `cosineSimilarity`/`queryNearest` retrieval primitives. Incremental
  indexing is `P2`, full rebuild is `P3`, both through the existing job
  queue; query-time embedding runs directly in the popup (see
  `docs/decisions/0009`).
- Phase 3C: `TinyClassifier` (execution-context-agnostic interface) +
  `HeuristicTinyClassifier` (deterministic, heuristic baseline covering only
  formality + directness — the other five T2 dimensions stay
  `SPEC_RESERVED`) + `TraitClassifierService` (idempotent classify + atomic
  profile fold-in, rebuildable from evidence, same pattern as
  `VectorIndexService`). Confidence-weighted incremental aggregation in
  `T2Profile`. `classify_evidence` is `P2`, `rebuild_t2_profile` is `P3`
  (see `docs/decisions/0010`).
- Phase 4 (PATTERNS layer): `PatternCompilerService` aggregates
  `EditMetrics`/`TraitScoreRecord` into context-scoped `Pattern` records
  (context resolved from evidence's `context.surface`, defaulting to
  `"unscoped"`), gated by an explicit evidence threshold
  (`PatternCompilerPolicy`) — no `Pattern` is emitted below threshold.
  `compile_patterns` is `P3`, manually triggered — see `docs/decisions/0011`.
- Phase 4 (T3, TRAITS/BELIEFS): `PersonaInterpreterService` interprets
  compiled `Pattern`s into `TraitBeliefClaim`s via a provider-agnostic
  `PersonaInterpreterProvider` interface, concretely implemented by
  `OpenRouterPersonaInterpreter` (the project's first network/LLM
  dependency). Gated by a deterministic evidence threshold
  (`PersonaInterpreterPolicy`) before any network call is made; only
  minimized `PatternCandidate` aggregates leave the device, never raw
  evidence or prior claims. `interpret_traits_beliefs` is `P3`, manually
  triggered. API key/model/enabled config lives in `chrome.storage.local`,
  outside the persona storage taxonomy — see `docs/decisions/0015`.
- Phase 5A (persona evidence utility validation): `SemanticDeltaExtractionService`
  extracts observation-centered `SemanticDeltaCandidate`s from `EditEvent`
  AI-output/human-edit pairs via a provider-agnostic
  `SemanticDeltaExtractorProvider` interface, concretely implemented by
  `OpenRouterSemanticDeltaExtractor`. Deliberately sends raw edit-pair text
  (unlike T3's minimized aggregates) — an explicit, disclosed
  privacy-boundary difference, opt-in via its own independent
  `SemanticDeltaExtractorConfigStore`. Per-source idempotent via
  `SemanticDeltaExtractionReceipt` (candidate existence alone can't signal
  "already processed," since a correct abstention produces zero
  candidates). `extract_semantic_deltas` is `P3`, manually triggered. Stops
  at OBSERVATION — no semantic aggregation/promotion into patterns or
  traits in this phase — see `docs/decisions/0016`.
- Post-3C fix: real-world Turkish evidence (35 samples) exposed that
  `HeuristicTinyClassifier` was silently English-only — `directness`
  saturated at a confidently-wrong 100%, `formality` was biased upward.
  Fixed with `isLikelyEnglish()`, which requires BOTH a non-ASCII-letter
  ratio ≤ 2% AND English function-word density ≥ 5%. The first version used
  only the non-ASCII signal; the operator rejected it and requested an
  ASCII-only-Turkish regression test, which exposed that diacritic-free
  non-English text (common in real typing) passes a character-only check —
  the function-word signal closes that gap. Both dimensions abstain (omit
  entirely) rather than emit a fabricated value when the gate fails — see
  `docs/decisions/0012`.

## Implemented capabilities

- `IndexedDbStorageAdapter`: get/put/delete/query, per-storage-class byte usage,
  `putMany` (atomic multi-key write via one IDBTransaction).
- `JobQueue`: enqueue, priority+FIFO ordering, `runNext`, `countsByPriority`,
  persists through `StorageAdapter`. At-least-once: `RUNNING` jobs whose lease
  (`startedAt`) expires (default 5 min) are reclaimed back to `PENDING` and
  retried, so a job interrupted mid-execution by MV3 service-worker
  termination is not lost — see `docs/decisions/0007`.
- `decideMode()` / `resource-governor.decide()`: `decideMode()` is a pure
  function of `(foregroundActive, inactiveDurationMs)` —
  INTERACTIVE/BACKGROUND/DEEP_IDLE, never queue backlog (`docs/decisions/0013`).
  `inactiveDurationMs` is computed at the runtime boundary
  (`entrypoints/background.ts`) by `computeForegroundInactivity()`
  (`extension/src/runtime/foreground-inactivity.ts`) from a *persisted*
  timestamp (`RuntimeStatus.foregroundInactiveSince`), not an in-memory
  tick counter — the latter could never accumulate across MV3
  service-worker restarts, making `DEEP_IDLE` structurally unreachable in
  real Chrome; see `docs/decisions/0014`. `decideMode()` is exported
  separately from `decide()` so mode is recomputed fresh, from storage,
  before each tick's dispatch. `decide()`'s batch-size halving/doubling on
  latency ratio is unchanged, still carried in memory across ticks (a
  self-correcting adaptation value, not a correctness-sensitive one).
- `RuntimeControls`: persisted `processingPaused`/`learningPaused` state.
- `stylometry.ts`: deterministic T0 extractors — sentence/word splitting,
  sentence-length distribution, punctuation-per-100-sentences, lowercase-start
  probability, emoji-per-word rate. No model calls, no randomness.
- `compileExpressionSheet()`: samples -> `ExpressionSheet`, populates only
  MVP_REQUIRED fields (asserted by test), never SPEC_RESERVED ones.
- `WritingSampleStore` (CANONICAL) / `ExpressionSheetStore` (DERIVED,
  rebuildable from samples at any time).
- `levenshteinDistance` / `jaccardWordOverlap` / `computeEditMetrics`: pure T0
  diff extractors over an EditEvent (AI text vs. human-edited final text).
- `applyEditMetrics()`: numerically-stable online mean update, no history
  rescan — folds one new EditMetrics into the running EditProfile.
- `EditEventStore` (CANONICAL) / `EditMetricsStore` (DERIVED, per-event) /
  `EditProfileStore` (DERIVED, running aggregate).
- `captureEditEvent()`: persist + enqueue P1 job, returns immediately — the
  actual T0/T1 computation runs later in the background dispatch loop.
- `process_edit_event` processor is idempotent: `EditMetrics.profileAppliedAt`
  is the receipt that stops a reclaimed/replayed job from double-counting
  `EditProfile`; the metrics write and profile write land atomically via
  `putMany()` so no crash window can leave the receipt and the profile
  update out of sync (`docs/decisions/0007`).
- Popup UI: onboarding textarea + Expression Sheet summary + edit-capture form
  + Edit Profile summary + real governor mode + last-eviction info, wired to
  live queue/storage/controls state, polls every 2s.
- `chrome.alarms`-driven background dispatch loop running the `noop` and
  `process_edit_event` processors, now mode-gated: `JobQueue.next()`/`runNext()`
  accept an `allowedPriorities` filter, and dispatch is restricted to
  `ALLOWED_PRIORITIES_BY_MODE[mode]` each tick.
- `ForegroundTracker`: tracks whether the popup is open via a long-lived
  `chrome.runtime.Port`, feeding the governor's real `foregroundActive` signal
  (previously hardcoded `false`).
- `planEviction()` (pure) / `evictIfNeeded()`: evicts CACHE, then DERIVED,
  then RAW records until back under `DEFAULT_STORAGE_POLICY.maxTotalBytes`;
  CANONICAL is never evicted automatically. Runs each dispatch tick, deletions
  skipped while `mode === 'INTERACTIVE'`.
- `RuntimeStatusStore`: persists the background loop's live
  `{ mode, batchSize, lastEvictionAt, lastEvictionBytesFreed }` (CACHE class)
  so the popup, a separate execution context, can display it.
- `HashingEmbeddingProvider`: deterministic FNV-1a character-3-gram hashing
  trick, L2-normalized, 128 dimensions. Non-semantic by design — see
  `docs/decisions/0009`.
- `VectorIndexService`: `indexOne()`, `rebuild()` (discards and recomputes
  the entire index from every registered canonical evidence source —
  `writing_sample` and `edit_event`, the latter embedding the human-edited
  `finalText`), `query()`.
- `EmbeddingStore` (`DERIVED`, keyed by `sourceType:sourceId`).
- Popup UI: Vector Index panel — embedding count, extractor id/version,
  "Rebuild index" button, similarity search (results show
  `sourceType:sourceId (score)`, no text-snippet resolution yet).
- `HeuristicTinyClassifier`: deterministic formality (word length,
  contraction/emoji/exclamation rate) and directness (hedge-phrase
  frequency) scoring, 0-confidence for empty text, confidence saturating at
  20 words. Non-validated heuristics, explicitly documented as such — see
  `docs/decisions/0010`.
- `applyTraitScore()`: confidence-weighted incremental mean per T2 dimension
  — same "no history rescan" principle as `applyEditMetrics()`.
- `TraitScoreStore` / `T2ProfileStore` (`DERIVED`).
- `TraitClassifierService`: `classifyOne()` (idempotent via
  `TraitScoreRecord.profileAppliedAt`, atomic dual-write) / `rebuild()`
  (discards and recomputes from `writing_sample` + `edit_event` sources,
  reusing the exact `embedding-sources.ts` adapters from Phase 3B).
- Popup UI: Behavioral Estimates (T2) panel — formality/directness as
  percentages with sample counts, explicit "heuristic estimates, not
  established traits" note, "Rebuild T2 Profile" button (enqueues the
  existing `rebuild_t2_profile` P3 job — same rebuild UX as the Vector
  Index panel's button). `deriveT2PanelState()`
  (`extension/src/persona/t2-panel-state.ts`) distinguishes no evidence at
  all from evidence the classifier abstained on from actually-classified
  evidence, so the abstention path (all-Turkish corpora on the
  English-only baseline) reads as "preserved but skipped," not as no
  samples having been submitted — see
  `docs/validation/manual-mvp-validation.md`.
- `aggregateObservations()`: pure, threshold-gated confidence-weighted
  aggregation by (dimension, context) — same weighting principle as
  `applyTraitScore()`.
- `PatternStore` (`DERIVED`, keyed by `dimension:context`).
- `PatternCompilerService.compile()`: full rebuild from `EditMetrics`
  (`compressionRatio`, `lexicalOverlap`) and `TraitScoreRecord`
  (`formality`, `directness`), context resolved per-record from the source
  evidence. Mirrors `VectorIndexService`'s rebuild contract.
- Popup UI: Patterns panel — dimension/context/value/sample-count list,
  "Compile patterns" button.
- `JobQueue.enqueueSingleton(type, priority, payload)`: enqueues only if no
  `PENDING`/`RUNNING` job of that `type` already exists, otherwise returns
  the existing one — generic coalescing, keyed by type alone. Used by all
  three full-rebuild job wrappers (`enqueueT2ProfileRebuild`,
  `enqueueVectorIndexRebuild`, `enqueuePatternCompilation`) so repeated
  clicks on a rebuild button can't accumulate duplicate `P3` jobs; see
  `docs/decisions/0014`.
- `TraitBeliefStore` (`DERIVED`, keyed by id) — TRAITS/BELIEFS claims,
  fully rebuildable from `PatternStore`.
- `PersonaInterpreterConfigStore` — OpenRouter API key, model id, enabled
  flag; backed by `chrome.storage.local` directly, deliberately outside
  `StorageAdapter`/the persona storage-class taxonomy — see
  `docs/decisions/0015`.
- `OpenRouterPersonaInterpreter implements PersonaInterpreterProvider` —
  the sole owner of `fetch`/credential handling; structured/schema-validated
  request+response, both the request's `response_format` and a defensive
  `validateClaimDraft()` on the parsed response.
- `PersonaInterpreterService.interpret()`: deterministic evidence-threshold
  gate (`isEligibleForInterpretation`, no network call below threshold) ->
  minimize `Pattern`s to `PatternCandidate`s -> provider call (never given
  the previous claim set, to avoid self-reinforcing drift) -> validate ->
  full-rebuild write to `TraitBeliefStore`. Provider constructed fresh from
  current config on every run, not cached in the service-worker closure.
- Popup UI: Traits/Beliefs (T3) panel — claim/context/confidence/
  supporting-pattern-count list, "Interpret traits/beliefs" button, inline
  settings form (API key, model id, enabled).
- `extension/wxt.config.ts`: `host_permissions: ['https://openrouter.ai/*']`
  — scoped to exactly the one provider origin in use.
- `SemanticDeltaCandidateStore` / `SemanticDeltaExtractionReceiptStore`
  (both `DERIVED`) — observation-centered evidence candidates and their
  per-source processing provenance, see `docs/decisions/0016`.
- `SemanticDeltaExtractorConfigStore` — independent `chrome.storage.local`-
  backed config (OpenRouter API key, model id, its own `enabled` flag),
  deliberately separate from `PersonaInterpreterConfigStore`.
- `OpenRouterSemanticDeltaExtractor implements SemanticDeltaExtractorProvider`
  — sends raw `originalText`/`finalText` (Phase 5A's documented,
  intentional privacy-boundary difference from T3), structured/schema-
  validated request+response, `validateCandidateDraft()` as the real
  enforcement point.
- `SemanticDeltaExtractionService.runExperiment()`: per-source idempotent
  (not full-rebuild) — skips a source only when an existing receipt's
  extractor identity matches the currently configured provider, so an
  intentional model/version change can still reprocess it, while an
  accidental repeat run never resends raw text for an already-processed
  source.
- Popup UI: Semantic Delta Extraction (Phase 5A — experimental) panel —
  readiness status, explicit raw-text-upload warning next to the trigger
  button, extracted/abstained receipt counts, candidate list, inline
  settings form.

## Known limitations

- `DEEP_IDLE_AFTER_INACTIVE_MS = 90_000` is a placeholder tuning value, not
  derived from measurement — see `docs/decisions/0013` and `0014`.
- No retry cap on stale-RUNNING reclaim: a job that reliably crashes the
  service worker every time it runs would be retried indefinitely rather
  than eventually marked `FAILED`. Not implemented — see `docs/decisions/0007`.
- `putMany()`'s atomicity currently relies on `IndexedDbStorageAdapter`
  keeping all records in one physical object store. A future SQLite/OPFS
  adapter would need its own transaction mechanism to preserve this
  guarantee behind the same `StorageAdapter` interface.
- Eviction budget (50 MB) is a hardcoded placeholder, not user-configurable —
  see `docs/decisions/0008`.
- Within-class eviction order is not LRU/recency-based, just whatever
  `listRecordMeta()` returns — see `docs/decisions/0008`.
- `foregroundActive` only reflects "is the popup open," not other foreground
  signals the doc mentions (tab focus, recent interaction latency).
- `HashingEmbeddingProvider` is not semantic — retrieval reflects character/
  lexical overlap, not meaning. Explicit, accepted tradeoff, not a bug — see
  `docs/decisions/0009`.
- `queryNearest` is a linear scan, not an ANN index — fine at MVP scale,
  untested beyond it.
- No UI resolution from a vector-search result back to its source text.
- `HeuristicTinyClassifier`'s formality/directness scores are crude,
  non-validated heuristics — explicit, accepted tradeoff, not a bug — see
  `docs/decisions/0010`.
- T2 confidence only reflects word count within the English-gated path —
  genre and other factors beyond language-applicability still aren't
  modeled. See `docs/decisions/0012` for the language-gate fix.
- `isLikelyEnglish()` doesn't attempt general language identification —
  non-English text that is both ASCII-only *and* happens to reuse enough
  English function words (rare, but conceivable for heavily code-mixed
  text) could still pass. Intentional, documented scope boundary — see
  `docs/decisions/0012`.
- No UI currently sets `context.surface` on writing samples or edit events,
  so in practice all pattern observations fall into the `"unscoped"` bucket
  today — the context-scoping architecture is correct and tested, just not
  yet exercised with real multi-context data. See `docs/decisions/0011`.
- Pattern dimensions are limited to what existing derived evidence exposes
  (`compressionRatio`, `lexicalOverlap`, `formality`, `directness`) —
  `editDistance`/`sentenceCountChange` excluded as unbounded raw counts.
- `PatternCompilerService.compile()` is a full rebuild, not incremental —
  acceptable for this job's `P3`/expensive-rare classification.
- `PersonaInterpreterConfigStore`'s API key has no encryption beyond
  whatever Chrome provides for extension local storage — an explicit,
  documented MVP tradeoff, not an oversight. See `docs/decisions/0015`.
- No per-request cost/rate limiting or spend cap on T3 interpretation —
  bounded only by `enqueueSingleton`'s existing one-outstanding-job
  coalescing, not by any cost-awareness logic.
- `SemanticDeltaExtractorConfigStore`'s API key has the same no-encryption-
  beyond-Chrome tradeoff as `PersonaInterpreterConfigStore`; no per-request
  cost/rate limiting either — see `docs/decisions/0016`.
- Phase 5A's optional (A) human-final-text-alone vs. (B) contrastive
  original+final control is documented but not implemented.

## Known gaps (intentionally deferred, not bugs)

- No live/passive capture — evidence only arrives via explicit user action
  (onboarding samples, manual edit-event form). Content-script-based live
  capture across web pages is `PLANNED`, pending a separate operator decision
  on `host_permissions` scope and privacy review (`docs/decisions/0005`).
- No character n-grams, typo-pattern detection, response-latency, or
  keystroke/session telemetry yet (Phase 2 T0 items not yet built).
- Five of seven T2 dimensions (warmth, assertiveness, politeness, emotional
  intensity, sarcasm likelihood) remain `SPEC_RESERVED` — typed, never
  computed. Sarcasm specifically needs conservative handling a simple
  heuristic can't provide — see `docs/decisions/0010`.
- EditProfile, the vector index, the T2 profile, and now Patterns are not
  yet wired into the Expression Sheet or any retrieval-for-generation flow —
  that integration belongs to Phase 5 (retrieval runtime), not this slice.
- No real (neural) embedding model or trained classifier, no WebGPU model.
- Governor's WebGPU-contention/battery/memory-pressure signals are typed
  (`SPEC_RESERVED`) but unwired — nothing produces them yet.
- Expression Sheet's SPEC_RESERVED fields (prosody, gesture, formality,
  directness, warmth) remain unpopulated by design.
- Sentence splitting is a naive regex (no abbreviation/decimal handling) —
  acceptable for T0 per the doc, documented in `stylometry.ts`.
- `.hdna` manifest type exists; no compiler/export pipeline.
- SQLite WASM + OPFS (doc's original Phase 0 storage mandate) not implemented —
  see `docs/decisions/0001-storage-indexeddb-first.md`.

## Current experiments / pending decisions

**Open: Phase 5A's ITERATE result.** `docs/decisions/0016` implements the
experiment (schema/protocol/provider/service/job/store/UI, fully tested)
and it has now been run once against the real 5-pair edit corpus and
human-graded. Result: **PIPELINE EXECUTION — PASS**, **INFORMATION GAIN —
PASS** (semantic candidates preserve materially more persona-relevant
information than `compressionRatio`/`lexicalOverlap` alone — the central
question Phase 5A exists to answer), **COVERAGE — PASS/BORDERLINE** (~1
`MISSED_SIGNAL` in 5 sources), **GROUNDEDNESS — FAIL** (66.7% `SUPPORTED`
vs. the required ≥80% — the extractor sometimes attributes to the human
edit meaning that was already present in the AI-drafted source),
**SMALL-MODEL VIABILITY — PROMISING / NOT YET VALIDATED** (`gpt-4o-mini`
extracted meaningful Turkish semantic differences, but the groundedness
shortfall leaves this open). Overall status: **Phase 5A: ITERATE** — not
abandoned, not declared validated. The persona-evidence-utility hypothesis
is not rejected by this result, but is not fully validated either; a
separate follow-up task is expected to address the identified
extraction-precision failure mode (confusing human-introduced
information with information already present in the AI source) — no such
fix has been implemented yet. See `docs/decisions/0016`'s "First real
experiment result" section and `docs/validation/manual-mvp-validation.md`'s
Phase 5A results table for full grading detail.

**That fix was Trial 1 (`docs/decisions/0016`'s "Trial 1" section):
REAL RESULT RECORDED — ITERATE, aggregate groundedness unchanged.** A
single controlled change to the extraction instruction — grounding every
candidate in the ORIGINAL→FINAL transformation via a mandatory
counterfactual check — targeted the failure mode above. Same 5 real
`EditEvent`s, same OpenRouter model (`openai/gpt-4o-mini`), same
schema/candidate kinds/receipt mechanism/acceptance thresholds;
`providerId` bumped to `openrouter/transformation-grounded-v1`, confirmed
by receipts to have reprocessed all 5 sources. **Real result: still 15
candidates, still 10/15 (66.7%) `SUPPORTED` — identical to baseline,
below the required ≥80% threshold.** A qualitative behavioral shift was
observed (more directional ORIGINAL→FINAL framing) but did not move the
aggregate score. Manual grading identified three remaining failure
classes: preserved+changed meaning mixed within one candidate, overlapping/
redundant candidates, and over-interpreted removals.

**Trial 2 (`docs/decisions/0016`'s "Trial 2" section): REAL RESULT
RECORDED — ITERATE, first quantitative groundedness improvement.**
Targeted the three Trial 1 failure classes by adding a deterministic,
language-general evidence-localization layer
(`extension/src/persona/revision-diff.ts`, `computeRevisionDiff`) ahead of
semantic interpretation — a word/token-level adaptation of Conijn et al.
(2022)'s restricted-Damerau-Levenshtein revision classification
(insertion/deletion/substitution/reordering) — plus explicit
atomic-candidate, local redundancy-avoidance, and removal-discipline
instruction rules. `providerId` `openrouter/evidence-localized-v2`,
distinct from both prior trials; confirmed by receipts to have reprocessed
all 5 sources. **Real result: 17 candidates, 12/17 (70.6%) `SUPPORTED` —
up from Trial 0/1's 66.7%, still below the required ≥80% threshold.**
`PARTIALLY_SUPPORTED` fell (26.7% → 17.6%) but `UNSUPPORTED` rose (6.7% →
11.8%) — both reported. A newly exposed failure class: the deterministic
layer can correctly localize *that* text changed while the semantic
extractor still assigns unsupported meaning to that change (`TEXTUAL
INTERVENTION != SEMANTIC CHANGE != PERSONA-RELEVANT EVIDENCE`), e.g. a
correctly-localized `davranışlarına` → `hareketine` replacement graded
`UNSUPPORTED` for an unsupported "narrowing" interpretation on top of it.
Conservative conclusion: localization appears useful but is not
sufficient. No claim of statistical significance, generalization, or
persona-reconstruction validation.

**Trial 3 (`docs/decisions/0016`'s "Trial 3"/"Trial 3 addendum"/"Trial 3 —
final zero-shot capability assessment" sections): REAL RESULT RECORDED —
COMPLETE.** Unlike Trial 1/2 (single-variable prompt changes on the same
provider/call-shape), Trial 3 is an **architecture validation trial**: it
moves localization, intervention construction, and admission entirely
into deterministic HDNA logic (`revision-diff.ts` reused unchanged from
Trial 2, plus new `revision-intervention.ts`/`semantic-revision-admission.ts`),
leaving the model only one narrow per-intervention judgment
(`no_meaningful_change`/`meaning_added`/`meaning_removed`/
`meaning_transformed`/`uncertain` + a one-sentence description), and
switches transport from OpenRouter to a **local MLX-LM server** running
**`Qwen3-0.6B`** on Apple Silicon (`LocalMlxSemanticRevisionJudge`), zero-
shot, thinking disabled, no fine-tuning/LoRA/SFT. **Real result: local
runtime/MLX execution PASS** (real sub-second per-intervention latency, no
cloud dependency); **zero-shot semantic capability FAIL** — broad semantic
matrix 52.9%, A/B discrimination 51% (chance level on a two-way forced
choice), coarse feature classification 14.9% (below every pre-declared
feasibility band). **This falsifies the hypothesis that unmodified
`Qwen3-0.6B` has sufficient zero-shot semantic capability for the Phase 5A
transformation — explicitly NOT a WebGPU/MLX/local-runtime blocker.** The
three scores are recorded as the official Phase 5A zero-shot tiny-model
baseline for future comparison. Trial 3 is marked COMPLETE; **Phase 5A
overall remains ITERATE**, not validated, not abandoned.

**Trial 4 (planned — external, not implemented; docs/decisions/0016's
"Trial 4" section) is the next research direction, documentation only:**
distillation/specialization (large-model teacher → filtered/versioned
training dataset → `Qwen3-0.6B` LoRA/SFT → held-out falsification →
failure-driven iteration), targeting the exact same `Qwen3-0.6B` model
Trial 3 measured (not a different/smaller model), so the effect of
training can be isolated against the Trial 3 baseline. Held-out
falsification-benchmark examples must never leak into training data;
failure categories may only inform new teacher-generated examples. No
training scripts, dataset generators/files, LoRA configs, model
artifacts, teacher calls, evaluation-harness changes, new extraction
architecture, new UI, or new extension runtime behavior exist in this
repository for Trial 4 as of this writing.

Sixteen operator decisions to date are recorded in `docs/decisions/`.
One decision (`0005`) is a scope boundary awaiting a future explicit operator
call: whether/how to add content-script-based live capture. Future work, each
`PLANNED` pending its own decision: a real neural embedding provider
(swapping `HashingEmbeddingProvider`, likely needing an offscreen-document
execution context per `docs/decisions/0009`); a real trained classifier or
additional heuristic T2 dimensions (`docs/decisions/0010`); a non-OpenRouter
`PersonaInterpreterProvider` or per-request cost/rate limiting for T3
(`docs/decisions/0015`); Phase 5A's optional (A)-vs-(B) control
(`docs/decisions/0016`); and retrieval runtime / WebGPU expression engine,
now explicitly **deferred (not cancelled)** pending the Phase 5A
evidence-utility answer, to actually wire derived signals (including
TraitBeliefClaims, and possibly SemanticDeltaCandidates) into anything
user-facing.

The research question that motivated Phase 5A (see
`docs/decisions/0015`'s "HUMAN-OPERATOR OBSERVATION / MVP DOGFOOD
FINDING" section) found that `compressionRatio`/`lexicalOverlap` — the
only two dimensions PATTERNS currently produces — don't carry enough
semantic information for T3 to construct a meaningful persona; the T3
pipeline itself (evidence → patterns → OpenRouter → persisted claims) is
confirmed working end to end. Phase 5A is this codebase's answer to "how do
we derive higher-information semantic preference/behavioral-delta evidence
from AI-output → human-edit deltas upstream of PATTERNS" — implemented and
ready to run, not yet validated as actually solving the problem.

## Current benchmark status

No benchmarks run yet — none are in scope for this PR (semantic-preservation,
persona-similarity, and operator-acceptance benchmarks belong to the WebGPU
Expression Engine phase, not this foundation).
