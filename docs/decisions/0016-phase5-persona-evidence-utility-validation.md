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

## Trial 1 — transformation-grounding extraction instruction (controlled experiment)

**Status: REAL RESULT RECORDED — ITERATE (no aggregate groundedness
improvement over Trial 0).** This section records a single controlled
follow-up to the baseline result above. The baseline/Trial 0 numbers above
are preserved unchanged; see "Real Trial 1 result (operator-graded)" below
for what actually happened when the operator ran it.

### Hypothesis

The baseline's groundedness shortfall (66.7% `SUPPORTED` vs. required
≥80%) was traced to a specific failure mode: the extractor sometimes
attributed to the human's edit meaning that was already substantially
present in the AI-drafted original and merely retained or rephrased in the
final text (see the "Important failure mode identified" subsection of the
first real experiment result above). Trial 1 tests:

> Can explicitly grounding extraction in the semantic transformation
> between ORIGINAL and FINAL — rather than in properties of FINAL alone —
> improve the `SUPPORTED` rate from 66.7% toward the pre-declared ≥80%
> threshold, without destroying the positive information-gain result?

This is the only experimental variable changed in Trial 1.

### What changed

**Only `buildPrompt()`'s extraction instruction, in
`extension/src/persona/openrouter-semantic-delta-extractor.ts`.** No
change to: `SemanticDeltaCandidate`/`SemanticDeltaExtractionReceipt`
schemas, candidate `kind` values, the extraction receipt's idempotency
*mechanism*, storage, queue behavior, UI behavior, promotion behavior (Phase
5A still stops at OBSERVATION), confidence semantics, the human-grading
rubric, or any of the pre-declared acceptance criteria/thresholds. The 5
real corpus `EditEvent`s, OpenRouter, and `openai/gpt-4o-mini` are all held
fixed, per the controlled-experiment design.

The new instruction adopts one core rule, stated in fully language-general
terms (no wording, suffix, morphology, or lexicon specific to Turkish,
English, or any other language):

> Semantic delta is not the meaning of the final text. Semantic delta is a
> directional change in meaning attributable to the human transformation
> from ORIGINAL to FINAL.

Meaning across that transformation is framed as PRESERVED, ADDED, REMOVED,
or (materially) TRANSFORMED; only ADDED/REMOVED/TRANSFORMED meaning may
produce a candidate — PRESERVED meaning is explicitly *not* new evidence.
Before every candidate, the model is instructed to apply a **mandatory
counterfactual grounding check**: "would this observation still be
supported having only ever seen the ORIGINAL, never the FINAL?" — if yes,
do not emit it. The instruction also explicitly warns that textual-diff
magnitude (edit distance, word count, presence of paraphrasing) is not a
proxy for semantic-change magnitude in either direction, and lists
illustrative (not exhaustive, not enum-like) categories of semantic/
pragmatic property that can shift under a small surface edit — stance,
modality, commitment, certainty, conditionality, intensity, framing,
specificity, directness, formality, interpersonal stance — without turning
that list into a closed taxonomy the model is limited to. The pre-existing
observation-first boundary (no stable personality/psychology/motivation
inference from one edit) and abstention-is-valid rule are both restated
unchanged; abstention explicitly favors fewer, better-grounded candidates
over candidate count. The `kind`/`preferred`/`rejected` contract from the
baseline (including the null-normalization fix) is unchanged.

**No language-specific rule was introduced.** The instruction never names
a language, and its one explicit self-referential warning ("do not rely on
any language-specific wording, suffix, or construction") is a warning
*against* such rules, not an instance of one — verified by a dedicated
regression test (see "Tests" below) that scans the actual outbound prompt
text for named languages, morphology terminology, and enumerated
language-specific forms.

### Extractor versioning

`SemanticDeltaExtractionService.runExperiment()`'s idempotency check keys
off `extractorId`+`extractorVersion` matching the *current* provider's
`providerId`+`modelId` (§"`SemanticDeltaExtractionReceipt` design" above).
Baseline's `providerId` was the bare string `'openrouter'`, and
`extractorVersion` is `provider.modelId` — which, per the controlled-
experiment constraint, must remain the literal string sent to OpenRouter's
`model` field (`openai/gpt-4o-mini`) and therefore cannot itself carry a
prompt-revision marker. Since Trial 1 changes only the prompt, not the
model, versioning by `modelId` alone cannot distinguish it from baseline —
exactly the gap this task's own instructions anticipated and permitted a
minimal fix for.

**Minimum necessary change:** a new exported constant,
`EXTRACTION_PROMPT_VERSION = 'transformation-grounded-v1'`, and
`providerId` is now `` `openrouter/${EXTRACTION_PROMPT_VERSION}` `` instead
of the bare `'openrouter'`. This is the only versioning change made — no
redesign of the receipt schema, the idempotency mechanism, or the
key-matching logic itself. Effect: the 5 sources already receipted under
baseline's `providerId: 'openrouter'` will **not** match Trial 1's
`providerId: 'openrouter/transformation-grounded-v1'`, so
`runExperiment()` will process all 5 again under Trial 1 — an intentional
re-extraction, not an idempotency bug — while a second Trial 1 run (same
`providerId`+`modelId`) would still correctly skip already-receipted
sources, preserving normal same-version idempotency. `modelId` itself is
untouched and still sent verbatim as `model: "openai/gpt-4o-mini"` in the
actual OpenRouter request body.

### Tests

`extension/tests/persona/openrouter-semantic-delta-extractor.test.ts`
gained a `Trial 1: transformation-grounding instruction contract` block
asserting on the real outbound prompt text (captured via the same fake-
fetch pattern the rest of the suite uses, not a copy of the prompt string)
for: preserved-meaning-is-not-evidence; added/removed/materially-
transformed meaning may be evidence; the mandatory ORIGINAL-only
counterfactual check; textual-diff-magnitude is not proof of semantic
change (both directions); the illustrative (non-exhaustive) semantic-
property list; the unchanged personality/psychology-inference prohibition;
the unchanged abstention-is-valid rule; absence of any named language or
enumerated language-specific form; and `providerId` correctly bumping to
`` `openrouter/${EXTRACTION_PROMPT_VERSION}` `` while `modelId` stays
exactly `openai/gpt-4o-mini`. These are prompt-contract assertions, not
tests of an external LLM's semantic reasoning (not deterministic, not
unit-testable), and hardcode none of the 5 real corpus `EditEvent`s.
`extension/tests/persona/semantic-delta-extraction-integration.test.ts`'s
two fixtures that hardcoded the baseline `extractorId: 'openrouter'`
(the already-processed-evidence skip test, and the cosmetic-edit-fixture
abstained-receipt assertion) were updated to reference
`EXTRACTION_PROMPT_VERSION` instead of a hardcoded string, so they track
the real constant rather than drifting from it. 392/392 tests pass, clean
`tsc --noEmit`, clean `wxt build`.

### How to rerun Trial 1 against the same 5 real EditEvents

1. In the popup's "Semantic delta extraction settings," confirm the model
   id is still `openai/gpt-4o-mini` (unchanged) and the OpenRouter API key
   is present; re-save if needed.
2. Click "Extract semantic deltas (Phase 5A)" as before. Because Trial 1's
   `providerId` differs from baseline's, none of the 5 sources' existing
   baseline receipts will match, so all 5 are reprocessed under the new
   instruction automatically — no manual receipt-store clearing is needed
   or should be performed.
3. Once the `P3` job runs (same `DEEP_IDLE` scheduling caveat as before),
   the panel will show up to 5 newly-processed sources and their new
   `SemanticDeltaCandidate`s, each carrying
   `extractorId: "openrouter/transformation-grounded-v1"` — visually
   distinguishable from baseline's `"openrouter"` in the panel's per-
   candidate `extractorId`/`extractorVersion` line, confirming Trial 1 (not
   a skipped/stale baseline receipt) actually produced them.
4. Grade the resulting candidates with the exact same rubric and the exact
   same ≥80% `SUPPORTED` / ≤1 `MISSED_SIGNAL` acceptance thresholds used
   for baseline (§"Pre-declared MVP experiment acceptance criteria" above)
   — do not adjust the thresholds based on Trial 1's outcome.
5. Record the real result in this section and in
   `docs/validation/manual-mvp-validation.md`'s Trial 1 subsection,
   preserving the baseline/Trial 0 result above rather than overwriting it.

### Real Trial 1 result (operator-graded)

The operator ran Trial 1 against the real 5-source corpus. Receipts
confirmed all 5 sources were reprocessed under the new extractor identity
(`extractorId: "openrouter/transformation-grounded-v1"`,
`extractorVersion: "openai/gpt-4o-mini"`, `outcome: "extracted"` for all
5) — not skipped by stale baseline receipts.

```text
Candidates               15

SUPPORTED                10 / 15 = 66.7%
PARTIALLY_SUPPORTED       4 / 15 = 26.7%
UNSUPPORTED               1 / 15 = 6.7%

TRIAL 0 GROUNDEDNESS      66.7%
TRIAL 1 GROUNDEDNESS      66.7%
PRE-DECLARED THRESHOLD    >=80%

PHASE 5A                  ITERATE
```

**The aggregate groundedness metric did not improve.** Trial 1 does not
clear the pre-declared ≥80% `SUPPORTED` threshold, exactly as Trial 0
didn't. This is recorded plainly, not softened: **Trial 1 did not pass.**

**Qualitative finding (not reflected in the aggregate number).** Manual
inspection found Trial 1 more often expressed observations as directional
ORIGINAL → FINAL transformations rather than merely describing properties
of the final text — e.g. identifying transformations such as
process-oriented validation → explicit core-value validation, an existing
explanation being removed/replaced by a different explanation, a generic
rest recommendation gaining a concrete consequence/personal observation,
and testing language being transformed into explicit shipping-plus-
feedback-collection. This suggests the transformation-grounding
instruction did measurably affect extractor behavior — but it was **not
sufficient to move the aggregate `SUPPORTED` rate**. Recorded as:

```text
Trial 1 targeted failure class:  QUALITATIVELY REDUCED / NOT ELIMINATED
Aggregate groundedness:          NO IMPROVEMENT
```

This finding should not be overstated — the corpus is only 5 edit pairs,
and a qualitative behavioral shift without a corresponding aggregate-score
shift is a weak, not strong, signal on its own.

**Remaining failure classes identified from manual grading**, which
directly motivate Trial 2 below:

1. **Preserved and changed meaning can still be mixed within one
   candidate.** A candidate may combine one genuinely human-introduced
   semantic change with another claim already substantially present in
   ORIGINAL, dragging the whole candidate down to `PARTIALLY_SUPPORTED`
   even though part of it is fully grounded. The extractor needs better
   localization of exactly which source material actually changed.
2. **Overlapping/redundant semantic candidates.** A single underlying edit
   can generate several highly-overlapping observations (e.g. separate
   candidates about avoiding expansion, validating core value, testing
   users, and demand-driven development from what is substantially one
   transformation), even when some of that meaning was already present in
   ORIGINAL and the genuinely new information is narrower. This inflates
   the evidence set and blurs the atomic unit of observation.
3. **Removal can be over-interpreted.** The removal of text is directly
   observable; a psychological or motivational explanation for *why* the
   human removed it usually is not. Trial 1's instruction did not
   specifically discipline this distinction.

See Trial 2 below, which targets these three classes directly (evidence
localization for #1, an explicit atomicity rule for #1 and #2, an explicit
local redundancy-avoidance rule for #2, and an explicit removal-discipline
rule for #3) — without changing the pre-declared acceptance criteria that
Trial 1 was, and Trial 2 will be, graded against.

## Trial 2 — deterministic evidence localization + atomic semantic deltas

**Status: REAL RESULT RECORDED — ITERATE. First quantitative groundedness
improvement (66.7% → 70.6%), still below the ≥80% threshold.** Trial 0 and
Trial 1's real results above are preserved unchanged; see "Real Trial 2
result (operator-graded)" below for what actually happened.

### Research question

Trial 1 still asked the model to locate semantic change by comparing two
complete raw texts end to end, in one reasoning pass. Trial 2 asks a
narrower question:

> Can HDNA improve extraction precision by deterministically localizing
> the human's textual intervention *before* semantic interpretation, while
> leaving semantic interpretation itself to the existing LLM extractor?

New architecture for this experiment:

```text
ORIGINAL + FINAL
        |
        v
deterministic textual alignment / diff
        |
        v
observed intervention regions
        |
        v
LLM semantic interpretation
        |
        v
atomic SemanticDeltaCandidates
```

This is the first Phase 5A iteration where HDNA itself provides explicit
evidence localization, rather than asking the LLM to discover all change
boundaries from two raw strings unaided.

### Conceptual boundary: the deterministic layer never determines meaning

The deterministic layer identifies *where* textual intervention occurred
(preserved / removed / added / replaced spans) — it never determines *what*
that intervention means semantically.

```text
TEXTUAL DIFF != SEMANTIC DELTA
```

A tiny textual edit may carry a major semantic effect; a large rewrite may
preserve essentially the same meaning. The LLM remains solely responsible
for semantic interpretation — this is stated explicitly to the model in the
prompt (see "Prompt contract" below), not just enforced by code structure.

### Language-general requirement

No rule introduced by Trial 2 is specific to Turkish, English, or any
other language. The localization utility (`extension/src/persona/
revision-diff.ts`) operates on generic whitespace-token boundaries only —
it has no notion of any language's words, morphemes, suffixes, or grammar.
The same alignment algorithm runs identically regardless of input
language; nothing in it was derived from, or tuned against, the 5 real
Turkish corpus `EditEvent`s.

### Deterministic diff/alignment algorithm chosen

**Algorithm: restricted Damerau-Levenshtein (optimal string alignment,
OSA) token alignment**, implemented from scratch in
`extension/src/persona/revision-diff.ts` (`computeRevisionDiff`) — no new
dependency added, consistent with this codebase's existing discipline of
not adding ML/HTTP/NLP libraries (see `docs/decisions/0015`'s
"Research/evidence used").

**This is a direct, word/whitespace-token-level adaptation of the
automatic revision-classification method in Conijn, Kleinberg & van den
Bosch, "A Product- and Process-Oriented Tagset for Revisions in Writing"
(2022):** they classify revisions into insertion, deletion, substitution,
and (adjacent) reordering by computing restricted Damerau-Levenshtein
distance *below word level*. `computeRevisionDiff` runs the equivalent
computation *at* the word/token level for HDNA's `EditEvent` pairs:
standard Levenshtein insert/delete/substitute costs (1 each, 0 for an
exact match), plus one additional case — a transposition of two
immediately adjacent tokens, also at cost 1. "Restricted" (equivalently,
OSA distance) means a transposed pair is never itself subsequently edited
again; this is exactly the constraint Conijn et al.'s method also imposes,
not a simplification introduced for this experiment. The DP and backtrack
(`alignTokens` in `revision-diff.ts`) implement this directly: this is not
an approximation of, or loosely "inspired by," the published method — it
is the same distance function, applied at the word/token granularity
suited to a single sentence-or-short-paragraph `EditEvent` pair rather
than Conijn et al.'s below-word-level granularity (full-document human
revision histories).

**Spangher et al.'s NewsEdits** (multilingual document-revision alignment
across full news-article version histories) was reviewed as directly
relevant related work — see "Academic connection" below — but its
alignment method was **not** adapted here: NewsEdits solves cross-version
alignment at article/sentence granularity across a full revision history,
with document-level structure (headlines, paragraphs, publication
timestamps) that a single AI-draft/human-final `EditEvent` pair does not
have. For HDNA's short, two-version `EditEvent` pairs, Conijn et al.'s
word-level restricted-Damerau-Levenshtein classification is the smaller,
better-fitting method, and is what this implementation actually follows —
this is not an ad-hoc diff heuristic invented to fit the current 5
examples; it is a direct application of the algorithm and constraint
already established by that published method.

**Why this specific, published method (not a hand-invented heuristic):**

- **Correct fit for the task's actual operation classes.** Conijn et al.'s
  scheme already names exactly the structural categories this experiment
  needs — insertion, deletion, substitution, and reordering — at the right
  granularity once applied at the token level, with no extra machinery
  invented on top.
- **Genuinely language-general.** The only "knowledge" the tokenizer has
  is whitespace-run segmentation — a generic structural split, not a
  word/morpheme boundary decision specific to any language. Restricted
  Damerau-Levenshtein itself is a string-edit-distance function with no
  linguistic content; it operates identically over any token alphabet.
- **No heavy dependency.** A from-scratch DP implementation (still O(n·m),
  with O(1) extra work per cell for the transposition case) avoids adding
  a diff/NLP library merely to satisfy an experimental, deliberately small
  utility — consistent with the task's explicit instruction to avoid a
  heavy dependency unless clearly justified, and with this being "an
  experimental extractor-support representation, not canonical persona
  evidence," which does not warrant new architectural surface area.
- **Bounded cost with an explicit fallback.** A `MAX_DP_CELLS` guard
  (250,000 token-pairs) makes unusually large inputs fall back to a single
  whole-text `'replaced'` operation rather than pay unbounded DP cost — a
  size-based safety net, not a content- or language-specific rule.

**Tradeoffs, documented rather than hidden:**

- Whitespace tokenization is not meaningful for languages that do not use
  whitespace to delimit words (e.g. Chinese, Japanese). This is an honest
  limitation of the generic approach, not a language-specific rule *for*
  any language — the algorithm behaves identically (word-boundary-blind)
  everywhere; it simply degrades toward character-adjacent behavior for
  non-whitespace-delimited scripts rather than failing outright. Not
  addressed in Trial 2; a genuinely universal segmentation strategy is
  future work if this direction proves worth pursuing further.
- The "restricted" transposition case only ever catches two *immediately
  adjacent* array tokens — tokens are defined as "optional leading
  whitespace + one whitespace-free run" specifically so that two
  neighboring words are adjacent array elements despite the whitespace
  between them in the source text, letting a genuine two-word swap be
  detected. A transposition spanning more than two tokens, or two swapped
  words separated by additional unchanged words, is not detected as a
  single `'reordered'` operation — it falls back to being represented as
  ordinary substitution/removal/addition, which is still a structurally
  correct (if less specific) account, per the same "restricted" constraint
  Conijn et al.'s method itself imposes.
- Adjacent delete+insert runs are merged into a single `'replaced'`
  operation via simple positional adjacency, not any semantic-similarity
  judgment that the two spans are "the same idea reworded" — documented in
  `revision-diff.ts`'s docstring so this heuristic is not mistaken for a
  semantic claim.
- Token alignment can legitimately match short, incidental shared tokens
  (e.g. a common short word appearing in both an unrelated ORIGINAL and
  FINAL) as small `'preserved'` spans even under an otherwise substantial
  rewrite — a correct property of the algorithm, not a bug, and not
  evidence of semantic equivalence (see the conceptual boundary above,
  restated explicitly to the model in the prompt).

### Output representation

```ts
export type RevisionOperationKind = 'preserved' | 'removed' | 'added' | 'replaced' | 'reordered';

export interface RevisionOperation {
  kind: RevisionOperationKind;
  originalText: string;
  finalText: string;
}

export interface RevisionDiff {
  operations: RevisionOperation[];
}
```

`'reordered'` is an addition beyond the task brief's illustrative
4-operation shape (explicitly "illustrative, not mandatory") — added
specifically because Conijn et al.'s classification scheme, which this
implementation follows, names reordering as a distinct structural category
from substitution; collapsing an adjacent word swap into two unrelated
substitutions would misrepresent the very method being adapted.

No new persistence schema and no `spec/schema`/`spec/protocol` addition —
`RevisionDiff` is computed fresh, in-memory, on every `extract()` call
(`openrouter-semantic-delta-extractor.ts`) and is never persisted;
`SemanticDeltaExtractionService` has no knowledge of it at all. This is
consistent with the task's explicit instruction not to create a large new
protocol/schema and to treat this as an experimental extractor-support
representation, not canonical persona evidence.

### How ORIGINAL + FINAL + localization are presented to the extractor

The full ORIGINAL and FINAL texts are **not** replaced by the diff — both
are still sent in full, exactly as in Trial 0/1, with the localization
appended as additional context:

```text
Original AI draft:
<full ORIGINAL text>

Human final text:
<full FINAL text>

OBSERVED TEXTUAL TRANSFORMATION (deterministic, structural only — not itself semantic evidence):
[PRESERVED] "..."
[REMOVED] "..."
[ADDED] "..."
[REPLACED] "..." -> "..."
[REORDERED] "..." -> "..."
```

(`formatRevisionDiff()` in `openrouter-semantic-delta-extractor.ts` — the
only place `RevisionDiff` is turned into prompt text; `revision-diff.ts`
itself has no notion of prompts or models.)

### Prompt contract

Every Trial 1 rule is retained **unchanged** (same exact wording, verified
by tests that were not modified): the CORE RULE (PRESERVED/ADDED/REMOVED/
TRANSFORMED), the MANDATORY CHECK counterfactual, the textual-diff-is-not-
proof-of-semantic-change warning, the observation-first boundary, and the
abstention-is-valid rule. Trial 2 adds four new instruction blocks:

1. **Localization boundary statement** — tells the model the OBSERVED
   TEXTUAL TRANSFORMATION section is deterministic and structural, marks
   *where* text was PRESERVED/REMOVED/ADDED/REPLACED/REORDERED (two
   adjacent spans swapped), does **not** determine *what* it means, and is
   "not itself evidence of anything"; a REPLACED or REORDERED span is not
   asserted to be semantically equivalent or insignificant, and a
   PRESERVED span does not mean nothing relevant happened elsewhere. The
   model is explicitly told to interpret every localized span "in the full
   context of the complete ORIGINAL and FINAL text," using the CORE
   RULE/MANDATORY CHECK above — the localization is context, not a
   substitute for that reasoning.
2. **ATOMICITY** — each candidate must represent exactly one independently
   supportable semantic transformation; a component that passes the
   MANDATORY CHECK must not be bundled with one that does not — emit only
   the genuinely new, narrowly-worded component rather than a broader
   combined claim. Directly targets remaining-failure-class #1 above
   (preserved+changed meaning mixed in one candidate).
3. **AVOID REDUNDANCY** — before returning candidates, check whether each
   one adds independently supported information beyond every *other*
   candidate for the same edit; do not emit multiple candidates restating
   the same underlying transformation in different words; candidate count
   is explicitly not a goal. Directly targets remaining-failure-class #2
   (overlapping/redundant candidates). This is **local, per-`EditEvent`
   deduplication only** — no cross-user or global semantic deduplication,
   and no embeddings, are introduced.
4. **REMOVAL DISCIPLINE** — that text was removed (or replaced) is itself
   directly observable and may be recorded; a motivation, reason, belief,
   or psychological explanation for *why* it was removed/replaced must
   **not** be inferred unless the FINAL text itself directly states that
   reason. Directly targets remaining-failure-class #3 (over-interpreted
   removals).

**No language-specific rule was introduced** in any of the four new
blocks — verified by the same class of regression test used for Trial 1
(scans the real outbound prompt for named languages/morphology
terminology). **No semantic or persona inference was added to the
deterministic layer itself** — `revision-diff.ts` contains no prompt text,
no model call, and no semantic vocabulary anywhere in its implementation;
all of the above instruction blocks live exclusively in
`openrouter-semantic-delta-extractor.ts`'s `buildPrompt()`.

### Trial 2 versioning

`EXTRACTION_PROMPT_VERSION` is bumped from `'transformation-grounded-v1'`
(Trial 1) to **`'evidence-localized-v2'`** (Trial 2), so `providerId`
becomes `openrouter/evidence-localized-v2` — distinct from both Trial 0's
bare `openrouter` and Trial 1's `openrouter/transformation-grounded-v1`.
Same minimal mechanism as Trial 1's versioning fix (no redesign of the
receipt schema or idempotency logic): the 5 sources' Trial 0 *and* Trial 1
receipts will not match Trial 2's `providerId`, so `runExperiment()`
reprocesses all 5 again automatically; `modelId` remains untouched,
still sent verbatim as `openai/gpt-4o-mini`. Because every receipt records
its own `extractorId`, all three trials' receipts/candidates remain
distinguishable from each other after the fact by inspecting that one
field — no separate trial-tracking mechanism was added.

### Tests

`extension/tests/persona/revision-diff.test.ts` (new) — generic,
language-independent unit tests for `computeRevisionDiff`: no-change
input produces only `'preserved'` operations; pure addition localizes the
added span with `originalText: ''`; pure removal localizes the removed
span with `finalText: ''`; replacement localizes the changed span while
preserving surrounding context as `'preserved'`; **an adjacent word-level
transposition localizes as a single `'reordered'` operation** (the direct
test of Conijn et al.'s restricted-Damerau-Levenshtein reordering class —
`'A X Y B'` → `'A Y X B'`); a large, substantially different rewrite is
represented without throwing and without falsely claiming whole-text
equivalence; a very small (single-character) edit is not discarded; a
reconstruction-invariant test (concatenating `originalText`/`finalText`
across all operations, in order, always reproduces the exact input) across
eight varied fixtures including empty-string ORIGINAL/FINAL and the
transposition case; every operation's `kind` is one of the five defined
values. No fixture uses Turkish suffixes, morphology, or any of the 5 real
corpus `EditEvent`s.

`extension/tests/persona/openrouter-semantic-delta-extractor.test.ts`
gained a `Trial 2: deterministic evidence localization + atomic/
redundancy/removal discipline` block verifying, on the real outbound
prompt text: `providerId` bumps to a distinct `evidence-localized-v2`
identity (not reusing Trial 1's); the OBSERVED TEXTUAL TRANSFORMATION
section is present and genuinely reflects the real input (asserts the
fixture's FINAL-only substring "MVP" surfaces under an `[ADDED]`/
`[REPLACED]` tag, not just anywhere in the prompt); the localization
boundary statement (identifies WHERE, not WHAT, "not itself evidence of
anything"); the full-context interpretation instruction; the ATOMICITY
rule; the AVOID REDUNDANCY rule; the REMOVAL DISCIPLINE rule; that every
Trial 1 rule is still present verbatim; and that the four new blocks
introduce no language-specific rule. These are prompt-contract assertions
over the real generated text, not tests of an external LLM's semantic
reasoning. 412/412 tests pass across the full suite, clean `tsc --noEmit`,
clean `wxt build`.

### How to rerun Trial 2 against the same 5 real EditEvents

1. In the popup's "Semantic delta extraction settings," confirm the model
   id is still `openai/gpt-4o-mini` and the OpenRouter API key is present;
   re-save if needed. No UI change was made for Trial 2.
2. Click "Extract semantic deltas (Phase 5A)". Trial 2's `providerId`
   (`openrouter/evidence-localized-v2`) does not match any Trial 0 or
   Trial 1 receipt, so all 5 sources are automatically reprocessed — no
   manual receipt-store clearing needed or expected.
3. Once the `P3` job runs (same `DEEP_IDLE` scheduling caveat as prior
   trials), the panel shows the newly-processed sources and candidates.
4. **Verifying the results belong to Trial 2, not Trial 0 or Trial 1:**
   each new `SemanticDeltaCandidate`'s per-candidate line shows
   `extractorId`/`extractorVersion` — confirm it reads
   `openrouter/evidence-localized-v2` / `openai/gpt-4o-mini`, distinct from
   Trial 0's plain `openrouter` and Trial 1's
   `openrouter/transformation-grounded-v1`. The extraction receipts
   (`semantic_delta_extraction_receipts` in IndexedDB, or the panel's
   processed-count line) carry the same field and can be cross-checked the
   same way.
5. Grade the resulting candidates with the exact same rubric and the exact
   same ≥80% `SUPPORTED` / ≤1 `MISSED_SIGNAL` thresholds used for Trial 0
   and Trial 1 — do not adjust them based on outcome.
6. Evaluate two separate questions, per the task's explicit framing — do
   not conflate them: **(a) trial-level** — did evidence localization +
   atomicity reduce preserved/changed-meaning mixtures, redundant
   candidates, and over-interpreted removals, relative to Trial 1?
   **(b) phase-level** — did aggregate groundedness reach ≥80% `SUPPORTED`?
   Trial 2 may show real qualitative improvement on (a) without yet
   passing (b); both should be recorded honestly, independent of each
   other.
7. Record the real result in this section and in
   `docs/validation/manual-mvp-validation.md`'s Trial 2 subsection,
   preserving the Trial 0 and Trial 1 results above rather than
   overwriting them.

### Real Trial 2 result (operator-graded)

Configuration held controlled, as designed: same 5 `EditEvent`s, OpenRouter,
`openai/gpt-4o-mini`, extractor `openrouter/evidence-localized-v2`.

**Grading (17 real candidates — more than Trial 0/1's 15, itself a
consequence of the atomic-candidate rule sometimes splitting what was
previously one bundled candidate into more than one narrower candidate,
not a change to candidate-count being a goal):**

```text
SUPPORTED                12 / 17 = 70.6%
PARTIALLY_SUPPORTED       3 / 17 = 17.6%
UNSUPPORTED               2 / 17 = 11.8%
```

```text
Trial 1 groundedness      66.7%
Trial 2 groundedness      70.6%

Change                    +3.9 percentage points
Phase 5A threshold        >=80%
Phase status               ITERATE
```

**This is the first observed quantitative improvement in the primary
groundedness metric.** It does not clear the pre-declared ≥80% threshold.
**Trial 2 did not pass Phase 5A** — recorded plainly, not softened.

**Secondary result — both directions recorded, not only the positive
one.** `PARTIALLY_SUPPORTED` share fell (26.7% → 17.6%), directionally
consistent with Trial 2's evidence-localization/atomicity objective.
However, `UNSUPPORTED` share *rose* (6.7% → 11.8%) — a real, reported
regression on that specific category, not omitted in favor of the
groundedness headline. With a corpus of only 5 `EditEvent`s (17
candidates), **no claim of statistical significance or generalization is
made** for any of these percentage-point movements.

**Newly exposed failure class: localized textual change mistaken for
meaningful semantic evidence.** Trial 2's real output surfaced a
distinction the implementation had not previously made visible:

```text
TEXTUAL INTERVENTION != SEMANTIC CHANGE != PERSONA-RELEVANT EVIDENCE
```

The deterministic localization layer can correctly identify *that* text
changed while the semantic extractor still assigns unsupported meaning to
that change — localization succeeding does not guarantee the semantic
interpretation built on top of it is grounded. Clearest example: the
deterministic layer correctly localized a replacement (`davranışlarına` →
`hareketine`); the semantic extractor interpreted this as the human
narrowing from broader "behavior" to more specific "actions." Manually
graded **UNSUPPORTED** — the textual change is real, but the claimed
semantic narrowing is not sufficiently supported by it. This is currently
one of the clearest remaining failure classes, and it is a new, more
specific finding than Trial 1's "preserved vs. changed meaning" mixture
problem: it is possible to pass the counterfactual/localization machinery
and still assign ungrounded semantic content to a genuinely localized
change.

**Second unsupported case — an interpretation/comparison error, not a
localization failure.** A candidate claimed the human described the
current version as better "without explicitly acknowledging prior
issues" — but the human's actual final text explicitly wrote "diğeri
karman çorman bişeydi" (an explicit acknowledgment of prior issues).
Manually graded **UNSUPPORTED**. Distinct from the localization-vs-meaning
failure class above: here the deterministic layer was not necessarily at
fault — the semantic extractor's comparative claim directly contradicts
text present in FINAL.

**Remaining `PARTIALLY_SUPPORTED` pattern (3 cases).** Continues to show:
mixing genuinely changed meaning with meaning substantially present in
ORIGINAL; correctly detecting a removal/reframing but adding unsupported
motivation for it; and turning an observable change in explanation into
psychological framing. Descriptions such as "minimizing the impact" or
"external justification" went beyond what the edit itself directly
established. The boundary this experiment must keep enforcing:

```text
observable semantic transformation != psychological explanation for the transformation
```

**Positive observations (corpus observations only, not evidence of
generalization).** Several clean cases: removal of "Bence" ("I think") was
correctly associated with a more assertive/direct formulation — a useful,
real illustration of the working principle `textual change magnitude !=
semantic/pragmatic change magnitude` (a single short removed word,
correctly read as a meaningful pragmatic shift). **This specific example
must not be turned into a Turkish-specific extraction rule** — it is
recorded as a corpus observation, not encoded into the language-general
extractor. Other clean examples: explicit introduction of validating the
project's core value before further development; feature-expansion
optimism replaced by explicit skepticism about demand/relevance; more
direct rest advice; addition of personal experience about taking breaks.

**Conservative interpretation.** Trial 2 produced the first quantitative
groundedness improvement, from 66.7% to 70.6%, while reducing the share of
partially-supported candidates from 26.7% to 17.6%. However, unsupported
candidates increased from 6.7% to 11.8%. Deterministic evidence
localization therefore appears useful in this small experiment but is not
sufficient: correctly identifying *where* a human edited text does not
establish that every localized edit represents a meaningful semantic delta
or persona-relevant signal.

```text
localization appears useful
but localization is not sufficient
```

No claim of causality, statistical significance, cross-language
generalization, or persona-reconstruction validation is made from this
result — 5 `EditEvent`s is not a corpus size that supports any of those
claims.

### Academic connection

Trial 2's deterministic localization layer is grounded directly in the
revision literature already introduced for Trial 1
(`docs/research/references.md`'s "Phase 5A Trial 1/2 additions") — not
merely thematically adjacent to it, but the actual algorithm this
implementation runs:

- **Conijn, Kleinberg & van den Bosch (2022), "A Product- and
  Process-Oriented Tagset for Revisions in Writing"** is the source this
  implementation directly follows, not just a loose precedent. Its
  automatic-classification method — restricted Damerau-Levenshtein
  distance below word level, distinguishing insertion, deletion,
  substitution, and (adjacent) reordering — is what `computeRevisionDiff`
  implements at the word/whitespace-token level (see "Deterministic
  diff/alignment algorithm chosen" above for the exact correspondence).
  `RevisionOperation`'s five kinds (`preserved`/`removed`/`added`/
  `replaced`/`reordered`) map directly onto that classification.
  **Not claimed to establish:** that this exact operation vocabulary or
  granularity is optimal for persona-relevant evidence localization
  specifically — Conijn et al.'s own work is about classifying revisions
  in writing generally, not about persona construction or AI-output/
  human-edit pairs.
- **Spangher et al., NewsEdits** (multilingual document-revision alignment
  across full news-article version histories) was reviewed as directly
  relevant related work on human-edit data as a first-class alignment
  problem, and is cited here as the reason a *different*, article/
  history-scale alignment approach was considered and set aside — see
  "Deterministic diff/alignment algorithm chosen" above for exactly why it
  does not fit HDNA's single, two-version, sentence/short-paragraph
  `EditEvent` pairs. **Not claimed to establish:** that NewsEdits' own
  alignment method would perform better or worse here — it was not
  adapted, so no comparative claim is made.
- **The surface/meaning-preserving vs. meaning-changing revision
  distinction** (Conijn et al.; also implicit in Lan, Zhang & Dragut's
  "revision intention" framing, and in WikiAtomicEdits' framing of edits
  as a first-class data source) is the direct conceptual precedent for
  this decision's `TEXTUAL DIFF != SEMANTIC DELTA` rule and for
  instructing the model that the deterministic layer does not itself
  determine meaning.
- **Does NOT establish:** that deterministic localization improves
  groundedness on HDNA's real corpus (an open, to-be-measured question —
  see "How to rerun" above); that restricted Damerau-Levenshtein/OSA is
  the right or optimal alignment strategy for *this* problem as opposed to
  Conijn et al.'s original one; or any claim about persona reconstruction,
  stable traits, or downstream persona fidelity — Phase 5A remains
  observation-only, and Trial 2 adds no promotion/aggregation/persona
  inference of any kind. The algorithm's role in this architecture is
  evidence localization only — it does not, and is not claimed to,
  "discover persona information."

### Trial 2 explicitly does not change

Per the task's explicit scope: no trait/persona promotion, no stable-
preference inference, no psychological inference, no cross-`EditEvent`
aggregation, no embedding similarity or clustering, no language-specific
NLP or morphology analysis, no new persona schema, no new candidate
`kind`, no confidence-calibration change, no different external model. The
controlled-experiment constants (5 real `EditEvent`s, OpenRouter,
`openai/gpt-4o-mini`, candidate schema, candidate kinds, confidence
semantics, grading rubric, ≥80% `SUPPORTED` threshold, coverage criterion)
are all held fixed — the only experimental change relative to Trial 1 is:
deterministic intervention localization + the atomic/redundancy/removal-
discipline instruction blocks above.
