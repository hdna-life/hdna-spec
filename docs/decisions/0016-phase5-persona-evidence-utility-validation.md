# 0016 — Phase 5A: persona evidence utility validation (semantic delta extraction)

## Decision

Implements a deliberately small, falsifiable experiment: whether an
AI-output → human-edit pair (an existing `EditEvent`) can be converted into
**grounded, provenance-linked `SemanticDeltaCandidate` evidence** that
carries materially more persona-relevant information than the two
deterministic dimensions PATTERNS currently produces
(`compressionRatio`, `lexicalOverlap` — see `docs/decisions/0011`).

This phase stops deliberately at the **OBSERVATION** level of the existing
evidence hierarchy:

```
CANONICAL EVIDENCE -> OBSERVATION -> REPEATED PATTERN -> TRAIT/BELIEF
```

One `SemanticDeltaCandidate` is not a `Pattern` and is not a
`TraitBeliefClaim`. No aggregation, repetition-thresholding, or promotion
into `PatternStore`/`TraitBeliefStore` is implemented in this phase — that
discipline (already established by `docs/decisions/0011`'s evidence
threshold and `0015`'s "no self-reinforcing drift" rule) is explicitly
preserved, not bypassed, by stopping here.

**Provider-agnostic interface, OpenRouter as the sole concrete
implementation**, same shape as `EmbeddingProvider`/`TinyClassifier`/
`PersonaInterpreterProvider`: `spec/protocol/semantic-delta-extractor.ts`
defines `SemanticDeltaExtractorProvider` (`providerId`, `modelId`, one
async `extract()` method) with no `fetch`/API-key/HTTP concept in the
interface itself. `OpenRouterSemanticDeltaExtractor`
(`extension/src/persona/openrouter-semantic-delta-extractor.ts`) is the
sole concrete implementation and sole owner of `fetch`/credential handling,
mirroring `OpenRouterPersonaInterpreter` (`docs/decisions/0015`) — including
defaulting `fetchImpl` to `fetch.bind(globalThis)`, the exact fix `0015`
needed after finding native `fetch`'s brand check throws "Illegal
invocation" under `this.fetchImpl(...)` call syntax in a real MV3 service
worker. That bug is not re-introduced here.

**Structured, schema-validated output, abstention as a first-class
outcome.** The OpenRouter request sets `response_format: { type:
'json_schema', ... }` describing `{ candidates: SemanticDeltaCandidateDraft[] }`.
A defensive second pass, `validateCandidateDraft()`
(`extension/src/persona/semantic-delta-extractor.ts`), rejects any draft
with out-of-range confidence, an empty `observation`/`context`, or a
`contrastive_preference` draft missing either half of its preference pair.
An empty `candidates` array is a valid, expected response — **abstention is
a successful extraction outcome**, not a failure — and the schema never
forces the model to invent a `preferred`/`rejected` pair for a
non-contrastive observation: `kind: 'behavioral_delta'` drafts are valid
with neither field present.

**`SemanticDeltaCandidate` design** (`spec/schema/semantic-delta-candidate.ts`):

```
SemanticDeltaCandidate {
  id
  sourceEvidenceId       // "edit_event:<id>" — the only source type this slice supports
  kind: 'contrastive_preference' | 'behavioral_delta'
  observation: string    // always present — a concrete, directly-observed description
  preferred?: string     // only meaningful/required for contrastive_preference
  rejected?: string      // only meaningful/required for contrastive_preference
  context: string        // same context-scoping convention as Pattern; "unscoped" default
  confidence: number     // 0..1, extraction confidence — NOT a trait-stability score
  extractorId
  extractorVersion
  computedAt
}
```

The kind enum is deliberately two values, not a persona-trait taxonomy.
`contrastive_preference` is for edits with a genuine "kept X over Y"
relation; `behavioral_delta` covers any other directly-observable semantic
difference (added/removed reasoning, strengthened/weakened a position,
changed framing, introduced a constraint, removed hedging, changed how
criticism is expressed, etc.) that doesn't reduce to a clean preference
pair. Adding a third kind value is explicitly out of scope without a
deliberate follow-up ADR — this must not grow into a general ontology.
Confidence is explicitly documented as an *extraction*-confidence signal,
never conflated with trait-stability or persona-confidence when this data
is later read.

**`SemanticDeltaExtractionReceipt` design**
(`spec/schema/semantic-delta-extraction-receipt.ts`,
`extension/src/persona/semantic-delta-extraction-receipt-store.ts`) exists
because "does a candidate already exist for this source" cannot represent a
successful abstention (zero candidates) — without a separate receipt, an
abstained source would look identical to a never-processed one and would
be resubmitted (re-sending raw edit-pair text) on every later experiment
run. The receipt is processing provenance, not persona evidence: it
carries no evidence text, only `sourceEvidenceId`, `extractorId`,
`extractorVersion`, `outcome` (`'extracted' | 'abstained'`), `processedAt`.
`SemanticDeltaExtractionService.runExperiment()` skips a source only when
its existing receipt's `extractorId`/`extractorVersion` matches the
*current* provider's identity — an intentional extractor/model change (a
different `modelId` configured before the next run) is **not** skipped and
reprocesses that source automatically, without requiring the operator to
clear the receipt store first. (An earlier docstring draft on
`SemanticDeltaExtractionReceiptStore` incorrectly implied a version change
never triggers reprocessing without a manual clear; that comment has been
corrected to match the real, tested behavior above.)

**Material privacy-boundary difference from T3 — stated explicitly, not
minimized.** T3 (`docs/decisions/0015`) sends only minimized
`PatternCandidate` aggregates. Phase 5A's `OpenRouterSemanticDeltaExtractor`
sends the **raw original AI draft text and the raw human final edit text**
(`EditEvent.sourceText`/`.finalText`) for every unprocessed `EditEvent` to
the configured OpenRouter model. This is the deliberate, documented
experimental design — the hypothesis under test is specifically whether
that raw contrastive pair carries recoverable semantic information that
minimized aggregates destroy — not an oversight or a relaxation of T3's
data-minimization default. It is opt-in via a config flag
(`SemanticDeltaExtractorConfig.enabled`) that is **structurally independent**
of `PersonaInterpreterConfig.enabled`: enabling T3 must never silently
enable raw-text upload for this experiment, so a separate store
(`SemanticDeltaExtractorConfigStore`) and a separate popup settings block
are used, even though both are `chrome.storage.local`-backed credential
config outside the `CANONICAL`/`DERIVED`/`CACHE`/`RAW` taxonomy, same
reasoning as `PersonaInterpreterConfigStore`. The extension's UI panel
(`SemanticDeltaExtractionPanel.svelte`) surfaces this raw-text disclosure
directly next to the trigger button, not only in the settings form's help
text.

**Job/execution model mirrors T3's, but the orchestration shape does
not.** `extract_semantic_deltas`
(`extension/src/queue/processors/semantic-delta-extraction-job.ts`) is
`P3`, manually triggered only, enqueued via `enqueueSingleton` (same
coalescing as `compile_patterns`/`interpret_traits_beliefs`). Unlike
`PatternCompilerService`/`PersonaInterpreterService`, which are full-rebuild
services, `SemanticDeltaExtractionService.runExperiment()` is per-source
and idempotent-by-construction (closer to `TraitClassifierService`'s
shape) — a full rebuild here would mean resending every EditEvent's raw
text to the model on every run, which the receipt-based skip logic exists
specifically to prevent.

**Why OpenRouter, not local/WebGPU inference, for this phase** — an
explicit operator decision. The immediate MVP objective is to establish
*whether* the evidence HDNA collects contains enough information to
materially improve persona fidelity, before investing further in *where*/
*how* that inference executes. OpenRouter already exists in the extension,
was exercised successfully in the real Phase 4/T3 dogfood run (see below),
minimizes implementation cost and time-to-experiment, and allows rapid
model substitution — including testing whether a small/cheap model can do
this job at all (see "Small-model viability" below). Local-sovereign
inference remains the architectural goal; it is **deferred/reordered, not
cancelled** — see the `docs/architecture/mvp-scope.md` update accompanying
this decision.

## Why this roadmap change exists

The first real Phase 4/T3 dogfood experiment (`docs/decisions/0015`,
"HUMAN-OPERATOR OBSERVATION / MVP DOGFOOD FINDING" section) successfully
ran the full pipeline — canonical evidence → deterministic metrics →
deterministic patterns → minimized `PatternCandidate`s → OpenRouter → T3
`TraitBeliefClaim`s — against real operator data: 5 real AI-output →
human-edit observations, compiled into exactly two `Pattern`s
(`compressionRatio/unscoped ≈ 0.84`, `lexicalOverlap/unscoped ≈ 0.09`). T3
produced claims broadly equivalent to "compressed communication suggests
efficiency/clarity" and "low lexical overlap suggests originality." The
operator concluded:

1. The technical pipeline works end to end, including the real network
   call.
2. Two deterministic dimensions do not contain enough semantic information
   to construct a meaningful persona.
3. T3 began crossing from observable behavior into unsupported motivation
   because the representation it was given was information-poor, not
   because of a reasoning failure in the interpreting model.
4. Increasing sample count while continuing to reduce every observation to
   the same two dimensions would increase confidence in those two
   measurements, not persona expressiveness.
5. This is an **information-representation bottleneck**, not a
   sample-count problem.

To be explicit and preserve this distinction going forward:

```
PIPELINE EXECUTION:            VALIDATED
PERSONA INFORMATION RICHNESS:  NOT VALIDATED / current representation insufficient
```

T3 is not a failed implementation — the finding is about what reached it,
not how it reasoned over what it was given.

## Academic basis

The following papers are adjacent motivation for the *hypothesis under
test*, not proof that HDNA's architecture works. For each, this decision
separates (a) bibliographic fact, (b) what the paper actually tested/
reports, (c) HDNA's inference from it, and (d) what it does **not** prove
about HDNA specifically. See also `docs/research/references.md`, updated
alongside this decision with condensed-notebook entries for the same four
sources.

### 1. EditPrefs

**(a)** Jan Majkutewicz, Julian Szymański (2025), "Aligning large language
models with human preferences using historical text edits," *Knowledge-
Based Systems*, Volume 322, Article 113566. DOI:
10.1016/j.knosys.2025.113566.

**(b)** Constructs preference-alignment data from historical text
revisions, treating a revision as preferred relative to its
previous/original version, and experimentally evaluates edit-derived
preference data for LLM alignment.

**(c) HDNA's inference:** this is the most direct academic motivation for
treating an edit — specifically the transformation from an earlier version
to a later, human-chosen one — as a potentially high-value evidence unit,
supporting the premise `HISTORICAL TEXT EDITS -> HUMAN PREFERENCE SIGNAL`.

**(d) Does NOT prove:** that AI-output → human-edit pairs specifically
(as opposed to human-authored revision histories, EditPrefs' actual
domain) reveal stable individual personas; that an LLM can reliably
extract *explicit semantic* persona evidence from an edit (EditPrefs uses
edits as implicit preference-pair training signal, not as extracted
natural-language observations); that a single semantic delta establishes a
trait; that repeated semantic deltas are sufficient to reconstruct a
persona; or that HDNA's evidence hierarchy (observation → pattern →
trait/belief) is the right or optimal one. All of these remain HDNA-
specific hypotheses.

### 2. Balepur et al., ACL 2025

**(a)** "Whose Boat Does it Float? Improving Personalization in Preference
Tuning via Inferred User Personas." DOI: 10.18653/v1/2025.acl-long.168.

**(b)** Studies personalization in preference tuning, motivated by the
observation that preference data indicates *what* was preferred but not
*why*, and explores inferring user personas/needs from preference data to
improve personalization outcomes.

**(c) HDNA's inference:** supports the general research direction
`PREFERENCE DATA -> INFERRED USER NEEDS/PERSONA -> PERSONALIZATION`, i.e.
that going beyond a bare preference signal toward an inferred
explanation/persona can be useful.

**(d) Does NOT prove:** that HDNA's specific semantic-delta-candidate
architecture, its provenance/receipt design, or its observation-only
(non-promoting) MVP scope is the correct way to do this. It is evidence
for the *direction*, not for this implementation.

### 3. Difference-aware user modeling, Findings of ACL 2025

**(a)** "Measuring What Makes You Unique: Difference-Aware User Modeling
for Enhancing LLM Personalization." DOI:
10.18653/v1/2025.findings-acl.1095.

**(b)** Proposes modeling *differences* between a user's preferences and
some baseline/other-users' preferences, rather than only absolute
preference values, to improve LLM personalization.

**(c) HDNA's inference:** used as support for preserving meaningful,
user-specific *preference differences* rather than collapsing behavior
into overly generic scalar aggregates — directly analogous to why
`compressionRatio`/`lexicalOverlap` alone are considered information-poor
in the 0015 finding above, and why Phase 5A represents each observation as
a described semantic delta rather than another single scalar dimension.

**(d) Does NOT prove:** that HDNA's specific `contrastive_preference` /
`behavioral_delta` split, or extracting differences via an LLM prompt
against a single edit pair (rather than the paper's own modeling
approach), is validated. Domain/task mismatch: the paper's "difference"
is between users or against a baseline, not between an AI draft and one
user's edit of it.

### 4. Persona-Plug, ACL 2025

**(a)** "LLMs + Persona-Plug = Personalized LLMs." DOI:
10.18653/v1/2025.acl-long.461.

**(b)** Proposes a plug-in persona-representation module built from
broader user-history representations, motivated by evidence that richer
history representations can capture habits/preferences that isolated
retrieval might miss, improving personalized generation.

**(c) HDNA's inference:** used only as evidence that *representation
quality* of user history materially matters for personalization outcomes
— i.e. that investing in a richer intermediate representation (which
Phase 5A is testing) is a reasonable thing to invest in, not a wasted
detour.

**(d) Does NOT prove:** that HDNA should adopt Persona-Plug's specific
plug-in/embedding architecture. It is cited only for the representation-
quality-matters premise, not adopted as an implementation.

### The HDNA-specific unproven bridge

The literature above gives adjacent support for two separate, narrower
claims: `human edits -> preference information` (EditPrefs) and
`preference/history representation quality -> personalization quality`
(Balepur et al., difference-aware modeling, Persona-Plug). It does **not**
establish HDNA's actual composition, which remains an open, falsifiable
hypothesis:

```
HUMAN EDIT
  -> GROUNDED SEMANTIC PREFERENCE / BEHAVIOR EVIDENCE
  -> REPEATED EVIDENCE
  -> PERSISTENT, INSPECTABLE PERSONA REPRESENTATION
  -> PERSONA FIDELITY
```

**Phase 5A tests only the first transformation** in that chain:

```
AI OUTPUT + HUMAN EDIT -> GROUNDED SEMANTIC DELTA EVIDENCE
```

This experiment is designed to be falsifiable. Successful implementation
(the code runs, produces schema-valid output, passes automated tests) is
explicitly not the same thing as successful validation of the hypothesis.

## Pre-declared MVP experiment acceptance criteria

Recorded here as **operator/project thresholds**, decided before running
the real experiment — explicitly **not** derived from any of the cited
papers, which report their own separate metrics on their own separate
tasks.

1. **Groundedness.** ≥ 80% of produced candidates should be human-rated
   `SUPPORTED`. `PARTIALLY_SUPPORTED` and `UNSUPPORTED` must not be
   silently counted toward this threshold.
2. **Coverage.** For the initial real 5-pair dogfood corpus, no more than
   1 important `MISSED_SIGNAL` (an edit containing an important semantic
   preference/behavior difference the extractor failed to represent at
   all) is the initial acceptance criterion.
3. **Information gain.** The central question: do the semantic candidates
   preserve materially more persona-relevant information than
   `compressionRatio`/`lexicalOverlap` alone? A system that merely
   paraphrases "the text became shorter" is not success, even if every
   candidate is technically `SUPPORTED`.
4. **Abstention quality.** Cosmetic/grammar-only transformations should
   produce zero candidates, not manufactured persona evidence. At least
   one synthetic cosmetic-edit fixture is included in automated tests as a
   guard for this even though it may not occur naturally in the real
   5-pair corpus (see the integration test's cosmetic-edit fixture, and
   `docs/validation/manual-mvp-validation.md`'s Phase 5A section).
5. **Small-model viability.** Record which OpenRouter model is actually
   configured for the first real run, and report honestly whether a
   cheap/small model can satisfy schema compliance, groundedness,
   abstention discipline, and useful semantic extraction — without
   silently substituting a stronger/more expensive model just to make the
   phase look successful. Small-model viability is itself part of what
   this experiment is testing, not an implementation detail to route
   around.

**Human-grading rubric** — per candidate: `SUPPORTED` (directly justified
by the original → final transformation) / `PARTIALLY_SUPPORTED` (a real
observation exists, but the candidate adds interpretation beyond what the
transformation establishes) / `UNSUPPORTED` (speculative, not established
by the edit pair). Per edit-pair, additionally: `MISSED_SIGNAL` (an
important semantic difference the extractor failed to represent). The
**human operator is the sole evaluator** — there is no automated
self-grading of the model's own output, and none is planned; `automated
tests confirm the pipeline is ready to run, never that the hypothesis is
confirmed`.

## Optional future control (documented, not implemented)

Documented per the operator's explicit request, deliberately left
unimplemented to avoid materially expanding this PR's scope:

- **Control A** — human final text alone → semantic evidence extraction
  (no AI original given to the model).
- **Condition B** — AI original + human final → contrastive semantic delta
  extraction (what this PR implements).

If B produces materially more grounded/informative evidence than A, that
would be direct HDNA-specific evidence that `EditEvent` pairs carry
preference information beyond what an ordinary writing sample already
would. This is optional future work, not a Phase 5A deliverable.

## Explicitly out of scope for Phase 5A

Deferred, not cancelled — these remain real future work, most already
tracked in `docs/architecture/mvp-scope.md`'s `PLANNED` section:

- WebGPU inference; local neural model execution; model download/cache
  infrastructure; real neural embedding replacement; trained/local
  classifiers; LoRA/adapters.
- Semantic clustering; retrieval runtime; persona-conditioned generation.
- Automatic promotion of `SemanticDeltaCandidate` observations into
  `Pattern`s or `TraitBeliefClaim`s (semantic candidate clustering,
  repetition aggregation, `SemanticPattern` promotion, automatic
  trait/belief generation from semantic deltas).
- Broad semantic analysis of writing samples generally (this phase reads
  only existing `EditEvent`s, not `WritingSample`s); continuous/background
  semantic upload (extraction remains explicit/manual/opt-in, never
  triggered automatically in the background).
- Additional unrelated T2 dimensions; learned reward models; DPO; EditPrefs
  reproduction/training; self-hosted inference work unrelated to this
  experiment.

## What the AI system was asked to evaluate

This is an explicit **operator-driven roadmap change**, following the real
Phase 4/T3 human dogfood finding above — not a scheduled next phase from
the original design document. The operator's framing, supplied directly
before implementation:

- Test evidence *utility*, not inference infrastructure — use the
  existing OpenRouter integration and a deliberately cheap/small model,
  not WebGPU/local inference, for this phase specifically.
- Stop at the observation level; do not implement aggregation/promotion
  into patterns or traits in this phase.
- The candidate schema must never pressure the model into fabricating a
  `preferred`/`rejected` pair for edits that aren't cleanly contrastive —
  `observation` is the primary grounded field, contrastive fields are
  optional and gated by `kind`.
- Structured output must support zero candidates as a valid outcome;
  abstention must be indistinguishable from "not yet processed" only in
  the sense that both eventually record a receipt, never in the sense
  that abstained sources get silently resubmitted.
- The raw-text privacy-boundary difference from T3 must be explicit and
  disclosed in the UI, not just documented in code comments.
- Only the `EditEvent` pair required for extraction is sent — no bulk
  upload of writing samples or unrelated canonical evidence, and no
  automatic background upload; extraction is manually triggered only.
- Minimal UI only: enough to run the experiment and inspect results, not a
  polished persona editor.
- Automated tests must cover the idempotency/receipt discipline, no raw
  evidence copied into stored candidates, no API key leakage into
  jobs/evidence/candidates/receipts/logs, and config survival across
  independent extension contexts.
- The success criterion is a human operator's evaluation of real output
  against the real `EditEvent` corpus, not automated test passing.

The system was asked to design and implement the
`SemanticDeltaExtractorProvider`/`SemanticDeltaCandidateDraft` contract,
the `SemanticDeltaCandidate`/`SemanticDeltaExtractionReceipt` schemas
(previously nonexistent in this codebase), `OpenRouterSemanticDeltaExtractor`
and its structured-output request/response validation,
`SemanticDeltaExtractionService`'s per-source idempotent orchestration, the
job/queue wiring, the popup settings/trigger/results panel, and full test
coverage with no real network calls — following the closest existing
precedent (`docs/decisions/0015`) wherever its pattern applied, and
diverging from it explicitly (full-rebuild vs. per-source-idempotent
orchestration; a second, independent config store and opt-in flag) where
Phase 5A's requirements differed.

## Alternatives considered

1. **A single, larger candidate-kind taxonomy** (e.g. separate kinds for
   "constraint added," "hedging removed," "criticism reframed," etc.) —
   rejected: the brief explicitly warns against building a persona
   ontology at this stage, and the two-value `kind` enum with a free-text
   `observation` field already captures those cases without a taxonomy
   that would need its own governance.
2. **Requiring `preferred`/`rejected` on every candidate** — rejected:
   this would pressure the model into fabricating a contrastive relation
   for edits that don't have one (e.g. adding a constraint, strengthening
   a position), producing lower-quality, less-grounded evidence purely to
   satisfy a rigid schema.
3. **Treating "a candidate exists for this source" as the idempotency
   check**, skipping a dedicated receipt store — rejected: this cannot
   represent a correct zero-candidate abstention, which would then look
   identical to "never processed" and get resubmitted (re-sending raw
   text) on every later run.
4. **A full-rebuild orchestration**, mirroring `PatternCompilerService`/
   `PersonaInterpreterService` exactly — rejected: a full rebuild would
   mean resending every `EditEvent`'s raw text on every experiment run;
   the per-source, receipt-gated idempotent shape (closer to
   `TraitClassifierService`) is required specifically because this phase's
   evidence transfer is expensive/sensitive in a way T3's minimized
   `PatternCandidate` transfer is not.
5. **Reusing `PersonaInterpreterConfigStore`/its `enabled` flag** for this
   experiment's config — rejected: enabling T3 must never silently enable
   raw-edit-text upload for a materially different privacy boundary; a
   structurally separate store and opt-in are required.
6. **A frontier/expensive model as the default** to make first-run results
   look more impressive — rejected: small-model viability is itself part
   of what this experiment is meant to establish; silently upgrading the
   model would make that finding meaningless.
7. **Local/WebGPU inference for this phase** — rejected per the operator's
   explicit ordering: prove the evidence-representation hypothesis first,
   then decide where/how to execute the winning representation. Not
   cancelled — deferred, see `docs/architecture/mvp-scope.md`.

## Known limitations

- `SemanticDeltaExtractionReceipt` is keyed by `sourceEvidenceId` alone in
  storage, with the extractor-identity check performed in
  `SemanticDeltaExtractionService.runExperiment()` at read time rather than
  as part of the storage key. This is an intentional MVP simplification:
  correct today (a version change does trigger reprocessing, verified by
  test), but means the receipt store cannot hold more than one
  outcome-per-extractor-version per source simultaneously — a future
  multi-extractor-version comparison (e.g. running two candidate models
  side by side against the same corpus) would need a schema change, not
  just new call sites.
- `SemanticDeltaExtractorConfigStore`'s API key has no encryption beyond
  whatever Chrome provides for extension local storage — same explicit,
  documented MVP tradeoff as `PersonaInterpreterConfigStore`
  (`docs/decisions/0015`), not an oversight.
- No per-request cost/rate limiting or spend cap on extraction runs —
  bounded only by `enqueueSingleton`'s one-outstanding-job coalescing and
  by the receipt store's skip-already-processed behavior, not by any
  cost-awareness logic.
- Small-model quality is genuinely unproven going into the first real run
  — that is the point of criterion 5 above, not a gap to be quietly
  patched by upgrading models.
- The structured-output JSON-schema hint sent to OpenRouter does not
  guarantee every downstream model honors `strict: true` —
  `validateCandidateDraft()` is the real enforcement point, by design, same
  discipline as `validateClaimDraft()` in `docs/decisions/0015`.
- Same P3/`DEEP_IDLE` dispatch-latency behavior 0015 documents applies
  here unchanged: `extract_semantic_deltas` only dispatches once
  `DEEP_IDLE` is reached (~90s of continuous foreground inactivity with the
  popup closed) — not a bug, but worth remembering when the popup shows no
  immediate results after clicking "Extract semantic deltas."
- The optional A/B control (final-text-alone vs. contrastive extraction)
  described above is not implemented.

## Current validation status

Implemented and tested across `spec/protocol/semantic-delta-extractor.ts`,
`spec/schema/semantic-delta-candidate.ts`,
`spec/schema/semantic-delta-extraction-receipt.ts`,
`extension/src/persona/semantic-delta-extractor.ts` (`validateCandidateDraft`),
`extension/src/persona/openrouter-semantic-delta-extractor.ts`,
`extension/src/persona/semantic-delta-candidate-store.ts`,
`extension/src/persona/semantic-delta-extraction-receipt-store.ts`,
`extension/src/persona/semantic-delta-extractor-config-store.ts`,
`extension/src/persona/semantic-delta-extraction-service.ts`,
`extension/src/persona/semantic-delta-extractor-form-state.ts`,
`extension/src/queue/processors/semantic-delta-extraction-job.ts`,
`entrypoints/background.ts`, `extension/src/ui/SemanticDeltaExtractionPanel.svelte`,
`entrypoints/popup/App.svelte`:

- `extension/tests/persona/semantic-delta-extractor.test.ts` — pure
  `validateCandidateDraft` cases: valid `contrastive_preference`, valid
  `behavioral_delta` with no `preferred`/`rejected`, missing-half
  `contrastive_preference` rejected, out-of-range confidence, empty
  `observation`/`context`.
- `extension/tests/persona/openrouter-semantic-delta-extractor.test.ts` —
  injected fake `fetch`: request shape (URL/model/auth header/json-schema
  `response_format`), confirms the raw `originalText`/`finalText` **are**
  present in the outbound request body (the intentional privacy-boundary
  difference from T3, asserted present rather than absent), valid- and
  zero-candidate response parsing, malformed/non-JSON content, non-ok HTTP,
  schema-mismatched candidates, and the `fetch.bind(globalThis)`
  brand-check regression guard against the default `fetchImpl`.
- `extension/tests/persona/semantic-delta-candidate-store.test.ts` /
  `extension/tests/persona/semantic-delta-extraction-receipt-store.test.ts`
  — CRUD, `DERIVED` classification, upsert-by-key semantics.
- `extension/tests/persona/semantic-delta-extractor-config-store.test.ts`
  — CRUD against an in-memory `chrome.storage.local` fake, default
  `{ enabled: false }`, independence from `PersonaInterpreterConfigStore`.
- `extension/tests/persona/semantic-delta-extraction-service.test.ts` —
  throws when not configured; provider called exactly once per
  unprocessed `EditEvent`; not called again for a source with an existing
  same-version receipt, for **both** `'extracted'` and `'abstained'` prior
  outcomes; **is** called again when the configured extractor
  version/model changes; zero valid drafts → `'abstained'` receipt with no
  candidates; partially invalid drafts filtered, valid ones persisted; no
  raw evidence text copied into a persisted candidate; candidate
  provenance fields set correctly; candidates + receipt written atomically.
- `extension/tests/queue/semantic-delta-extraction-job.test.ts` — `P3`
  priority, `enqueueSingleton` coalescing, processor invokes
  `service.runExperiment()`.
- `extension/tests/persona/semantic-delta-extraction-integration.test.ts`
  — full pipeline against a shared fake `chrome.storage.local` +
  `fake-indexeddb`: config saved via one store instance read by an
  independent instance through to an actual fake `fetch()` call; a real
  seeded `EditEvent`'s `sourceText`/`finalText` reach the outbound request
  unmodified; provider invoked exactly once for eligible unprocessed
  evidence; not invoked for already-receipted evidence; not invoked at all
  when config is missing/disabled (job observably `FAILED`, not a silent
  no-op); survival across a simulated service-worker restart; a synthetic
  cosmetic spelling-fix fixture producing a zero-candidate `'abstained'`
  outcome end-to-end without error; no test API key ever appearing in a
  persisted candidate/receipt record.

All Phase 5A tests pass alongside the full existing suite — see the PR's
test run output for the exact combined count; this document does not
restate a specific number to avoid it going stale as unrelated tests are
added elsewhere in the repo. `tsc --noEmit` passes for the UI/store code
added in this decision.

**Passing automated tests means the experiment is ready to run against the
real `EditEvent` corpus — it does not mean the Phase 5A hypothesis has been
validated.** The persona-evidence-utility question itself remains open
until a human operator grades real `SemanticDeltaCandidate` output against
the real corpus per the rubric and acceptance criteria above (see
`docs/validation/manual-mvp-validation.md`'s Phase 5A section for the exact
manual steps). No such grading has been recorded yet as of this decision.

## Post-implementation fix: real-provider JSON Schema `required` incompatibility (found via the first real dogfood run)

The first real Phase 5A dogfood attempt — an actual OpenRouter request
against real OpenAI/Azure-compatible model providers — failed before any
candidates could be produced, with OpenRouter returning HTTP 400:

```text
Invalid schema for response_format 'semantic_delta_candidates':
In context=('properties', 'candidates', 'items'),
'required' is required to be supplied and to be an array including every
key in properties. Missing 'preferred'.
```

**Root cause.** `CANDIDATE_DRAFT_JSON_SCHEMA`
(`extension/src/persona/openrouter-semantic-delta-extractor.ts`) declared
`preferred`/`rejected` in `properties` but omitted them from `required`,
matching this decision's domain model (optional, meaningful only for
`contrastive_preference`). Strict OpenAI/Azure-compatible structured
outputs (`strict: true`) do not support an "optional property" at the JSON
Schema level at all — every key present in `properties` must also appear
in `required`, full stop. This is a **wire-format constraint of the
provider ecosystem**, not a property of the domain model this decision
established; the two were conflated in the original schema.

**Fix — adapt only the provider/wire representation, not the domain
model.** `preferred`/`rejected` are now typed `['string', 'null']` and
listed in `required` in the JSON Schema sent to OpenRouter, so a
`behavioral_delta` candidate is now spelled with explicit `null`s:

```json
{
  "kind": "behavioral_delta",
  "observation": "Removed explanatory framing while retaining the core recommendation.",
  "preferred": null,
  "rejected": null,
  "context": "unscoped",
  "confidence": 0.9
}
```

A new wire-level type, `OpenRouterCandidateDraftWire` (`preferred`/
`rejected`: `string | null`, always present), is validated by
`isValidWireDraftShape()`, then translated to the unchanged domain
`SemanticDeltaCandidateDraft` (`preferred?`/`rejected?`: `string |
undefined`) by `normalizeWireDraft()` — the only place in the codebase
that knows about this provider-specific `null` convention.
`validateCandidateDraft()`, `SemanticDeltaExtractionService`,
`SemanticDeltaCandidate`, and every other Phase 5A domain type are
**unchanged**: `preferred`/`rejected` remain genuinely optional in the
HDNA domain model, still required together only for
`contrastive_preference`, and `validateCandidateDraft()` still rejects an
empty-string or missing preference half exactly as before. The prompt
sent to the model was also updated to say every candidate must include
`preferred`/`rejected` keys, set to `null` when not applicable, so the
model reliably produces the now-required shape rather than omitting the
keys and re-triggering the same HTTP 400.

**This is a provider-compatibility fix, not a change to Phase 5A's scope,
evidence hierarchy, candidate-kind taxonomy, or acceptance criteria.** No
new candidate kind was added, promotion behavior is unchanged, and the
pre-declared acceptance criteria above are unaffected.

**Regression coverage.**
`extension/tests/persona/openrouter-semantic-delta-extractor.test.ts` adds:
a real-shaped response with `preferred`/`rejected` both `null` on a
`behavioral_delta` candidate, asserting it is accepted and normalized to
`undefined` (the exact shape that triggered the real HTTP 400 before this
fix); a `contrastive_preference` response with real string
`preferred`/`rejected` values; and an assertion that the requested JSON
Schema's `items.required` array lists all six candidate properties
(previously only four) with `preferred`/`rejected` typed `['string',
'null']`. `extension/tests/persona/semantic-delta-extractor.test.ts` adds
an explicit case confirming `validateCandidateDraft()` still rejects a
`contrastive_preference` draft with empty-string `preferred`/`rejected` —
the post-normalization form of a wire-level `null`. The three
`behavioral_delta` fixtures in
`extension/tests/persona/semantic-delta-extraction-integration.test.ts`
were updated to include explicit `preferred: null, rejected: null`,
matching what a real strict-schema-compliant provider now sends. 380/380
tests pass, clean `tsc --noEmit`, clean `wxt build`.

The extension is ready to retry the same real 5-`EditEvent` Phase 5A
experiment that originally surfaced this bug.

## First real experiment result (operator-graded, human dogfood)

**Documentation-only record.** This section reports the first real
human-operator run and its grading; it does not change the extractor,
prompt, schemas, architecture, or the acceptance criteria declared above.
No implementation change was made in response to this run — the failure
mode identified below is recorded as a finding for a separate follow-up
task, not addressed here. Full step-by-step results and the per-criterion
grading table live in `docs/validation/manual-mvp-validation.md`'s
"Results — first real experiment (operator-graded)" section; this section
records the outcome against this decision's own pre-declared criteria.

**Run.** OpenRouter, model `openai/gpt-4o-mini`, against the real 5
Turkish `EditEvent` corpus. 5/5 sources processed, 5/5 produced extracted
candidates (0 abstained), 15 total `SemanticDeltaCandidate`s produced. The
run completed with no HTTP/schema errors, confirming pipeline execution
end to end in the real unpacked extension against real persisted evidence
and a real external model — the same "pipeline execution: validated"
distinction this decision and `docs/decisions/0015` before it maintain
separately from persona-information-richness/hypothesis validation.

**Grading against the pre-declared criteria (§"Pre-declared MVP experiment
acceptance criteria" above) — none of these thresholds were changed after
seeing the result:**

```text
PIPELINE EXECUTION       PASS
INFORMATION GAIN         PASS
COVERAGE                 PASS / BORDERLINE
GROUNDEDNESS             FAIL (66.7% vs required >=80%)
SMALL-MODEL VIABILITY    PROMISING / NOT YET VALIDATED

PHASE 5A                 ITERATE
```

- **Groundedness: FAIL.** 10/15 (66.7%) `SUPPORTED`, 4/15 (26.7%)
  `PARTIALLY_SUPPORTED`, 1/15 (6.7%) `UNSUPPORTED`, against the required
  ≥80% `SUPPORTED` (`PARTIALLY_SUPPORTED` does not count toward it, per
  the criterion as originally declared).
- **Coverage: PASS/BORDERLINE.** ~1 important `MISSED_SIGNAL` in the
  5-source corpus (an apology edit whose reconciliation/closure-language
  removal and sharper reframing of the explanation for the behavior were
  not fully represented) — within the pre-declared "no more than 1" bound,
  but not treated as a clean pass given the corpus size.
- **Information gain: PASS.** The central question this decision exists to
  answer. The extracted candidates preserved observable, human-readable
  semantic distinctions — e.g. MVP-first prioritization over feature
  expansion, shipping-and-feedback vs. continued iteration, neutral →
  direct/blunt recommendation framing, formal → informal register shifts,
  added personal experience, strengthened criticism, reframed
  apologies/explanations — that `compressionRatio`/`lexicalOverlap` cannot
  represent. **This is evidence about the semantic-evidence-extraction
  step only; it is not evidence of persona reconstruction, stable traits,
  or downstream persona fidelity**, which remain untested by Phase 5A per
  the evidence-hierarchy discipline stated at the top of this decision.
- **Small-model viability: PROMISING / NOT YET VALIDATED.** `gpt-4o-mini`
  (a deliberately cheap/small model, not upgraded mid-experiment to make
  the result look better, per this decision's explicit rule) extracted
  many meaningful Turkish semantic differences from real evidence. Not
  marked validated because the groundedness shortfall below leaves open
  whether it is a small-model capability limit or an extraction-design
  issue — a question a small model's output alone cannot resolve.
- **Model-reported confidence** clustered ≈0.80–0.95 across the 15
  candidates. Consistent with, and gives no reason to revisit, this
  decision's existing rule that `confidence` is extraction confidence
  only, never persona/trait confidence.

**Failure mode identified (finding only — no fix implemented here; a
separate follow-up task will decide how to address it).** Groundedness
loss was driven primarily by the extractor conflating (1) information the
human's edit actually introduced, removed, strengthened, weakened, or
reframed with (2) meaning already substantially present in the AI-drafted
source and merely retained or rephrased in the human's final text. Example
class: source "avoid adding more features and test with users" → final
"don't unnecessarily expand scope; ship the MVP and test it" — the
extractor may emit "prefers avoiding feature expansion" as a delta, which
describes the final text accurately but was already present pre-edit, so
it cannot be attributed to the edit as newly observed evidence. This is an
**extraction-precision** problem, not evidence that the underlying
semantic information is absent from `EditEvent` pairs (see "Information
gain" above) or that the hypothesis under test is false.

**Conclusion — Phase 5A: ITERATE, not abandoned, not declared validated.**
This result does not provide a reason to reject the Phase 5A hypothesis:
it shows meaningful persona-relevant semantic information is present in
human edits and recoverable even by a small/cheap model. It also shows the
current extraction is not yet precise enough to clear the pre-declared
groundedness bar. Both are true at once, from a single 5-pair real corpus
— read as promising early evidence, not proof of persona reconstruction.
Per this task's explicit scope, no extractor, prompt, schema, or
architecture change was made as part of recording this result; the
extraction-precision failure mode above is left for a dedicated follow-up
decision/PR.
