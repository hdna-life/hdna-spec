# Manual MVP validation — human operator, real unpacked extension

Real-world manual testing was performed using the unpacked Chrome extension
on macOS with actual user-provided Turkish writing samples and manually
edited AI-output pairs. This is a record of what that testing found, kept
separate from the automated test suite, which did not catch several of
these issues on its own.

## Environment

- Real Chrome/Chromium MV3 extension
- Local IndexedDB persistence
- Real background-service-worker lifecycle
- No synthetic browser harness for these observations
- 35 real writing samples were used during the main test corpus
- Samples included technical/product conversation and informal
  WhatsApp-style writing from different personal relationships
- 5 real human rewrites of AI-generated Turkish text were added as
  `AI output -> human edit` evidence

## Phase 1 — Writing samples / Expression Sheet

35 canonical writing samples were ingested successfully.

Observed Expression Sheet after corpus expansion:

- Sentences analyzed: 44
- Mean sentence length: 8.5 tokens
- Lowercase sentence starts: 52%
- Emoji per word: 0.0%

The Expression Sheet responded visibly to corpus changes. Earlier
technical/task-oriented samples produced a mean sentence length of 10.5
tokens and 76% lowercase sentence starts; adding more natural
conversational samples moved these values to 8.5 tokens and 52%.

Canonical evidence remained persisted throughout rebuilds and
derived-artifact changes.

## Phase 3B — Vector index

All 35 writing samples were eventually processed into the deterministic
vector index.

Observed final state:

- 35 embeddings
- Extractor: `hashing-ngram v1.0.0`
- P2 queue drained to 0

This validated real background processing, derived embedding persistence,
and vector-index integration in the unpacked extension.

## Phase 3C — T2 classifier: multilingual failure discovered

Initial manual result after all 35 samples were processed:

- Formality: 76%
- Directness: 100%
- Classified samples: 35/35
- P2 queue: 0

This exposed a real classifier-quality bug that was not caught by the
automated suite.

Root cause:

- Directness relied entirely on English hedge phrases, causing Turkish
  input to produce zero hedge matches and therefore saturate at `1.0`.
- Formality also contained English-specific contraction signals and
  English-oriented word-length calibration, materially biasing Turkish
  evidence.

An initial non-ASCII language gate was rejected after an ASCII-only Turkish
regression case demonstrated that normal Turkish typing without diacritics
could still be misclassified as English.

The revised classifier now abstains on unsupported evidence rather than
fabricating neutral or confident scores (see `docs/decisions/0012`).

After rebuilding T2 on the same preserved canonical corpus:

- Previous incorrect Formality/Directness values disappeared
- 35 evidence items remained preserved
- 0 evidence items were classified by the current English-only T2 heuristic

The popup's T2 panel originally rendered this outcome as "No evidence
classified yet." — indistinguishable from having submitted no writing
samples at all, and easily misread as evidence having been discarded. The
panel was updated (`extension/src/ui/T2ProfileSummary.svelte`,
`extension/src/persona/t2-panel-state.ts`) to distinguish:

- no evidence at all,
- evidence preserved but unsupported by the current heuristic,
- successfully classified evidence.

Observed UI state after the fix, on the same corpus:

> No supported evidence classified yet.
>
> The current heuristic baseline only classifies supported English
> evidence; other evidence is preserved but skipped.
>
> 35 evidence items preserved; 0 classified by the current T2 heuristic.

This behavior is considered correct for the current deterministic
baseline.

## Phase 3A / P3 scheduling — starvation bugs discovered

Manual testing exposed two independent P3 liveness failures.

### Failure 1 — backlog-dependent DEEP_IDLE

A pending P3 job kept total backlog above zero.

The governor selected `BACKGROUND` whenever backlog was nonzero, while P3
was only allowed in `DEEP_IDLE`.

Result:

```
P3 pending -> backlog > 0 -> BACKGROUND -> P3 disallowed -> backlog remains > 0
```

The job could never run.

This was fixed by decoupling runtime mode from queue backlog (see
`docs/decisions/0013`).

### Failure 2 — MV3 service-worker lifecycle

The first fix used an in-memory `idleTicks` counter.

Real Chrome MV3 behavior could terminate the service worker between alarm
wakes, resetting `idleTicks = 0` on each worker reconstruction.

This prevented sustained-idle state from accumulating in real browser
operation.

The final implementation replaced ephemeral idle-tick state with persisted
wall-clock inactivity state (`foregroundInactiveSince`), allowing
`DEEP_IDLE` eligibility to survive service-worker restarts (see
`docs/decisions/0014`).

Manual retest confirmed:

- `DEEP_IDLE` became reachable
- P3 rebuild jobs drained successfully
- P3 queue returned to 0

## Duplicate rebuild work discovered

Repeated clicking of "Rebuild T2 Profile" during debugging produced 82
pending P3 jobs.

The queue was updated with generic singleton/coalescing behavior for full
rebuild operations (`JobQueue.enqueueSingleton`, see `docs/decisions/0014`).
Applied to:

- `rebuild_t2_profile`
- `rebuild_vector_index`
- `compile_patterns`

Pending/running equivalent jobs are now deduplicated; completed or failed
jobs do not block future legitimate rebuilds.

## Phase 2 — AI-output -> human-edit evidence

Five real Turkish AI-output/human-edit pairs were captured.

Observed Edit Profile:

- Edits observed: 5
- Mean edit distance: 188.4
- Mean compression ratio: 0.84
- Mean lexical overlap: 9%

This indicates substantial rewriting in this small test corpus rather than
minor surface editing, but no higher-level personality claim is made from
five observations.

## Phase 4 — deterministic PATTERNS

After the edit-processing queue fully drained, `compile_patterns` was
triggered as P3 work.

The P3 job successfully completed in real Chrome after the
scheduler/lifecycle fixes above.

Observed compiled patterns:

- `compressionRatio / unscoped: 84% (5 samples)`
- `lexicalOverlap / unscoped: 9% (5 samples)`

No formality/directness patterns were produced because the current T2
baseline correctly abstains on the Turkish evidence.

All current evidence is effectively `unscoped` because the UI does not yet
capture `context.surface`.

## Human-operator conclusion

The real extension successfully demonstrated the following end-to-end path
outside the automated test environment:

```
real human evidence
  -> CANONICAL persistence
  -> queued background processing
  -> DERIVED metrics
  -> vector representation
  -> classifier abstention where unsupported
  -> thresholded deterministic pattern compilation
```

Manual testing also found multiple issues that unit/integration tests had
not exposed:

1. multilingual T2 confidence failure,
2. P3 backlog starvation,
3. P3 MV3 restart starvation,
4. unbounded duplicate rebuild jobs,
5. misleading abstention UI state.

Each was reproduced from real operator behavior and addressed before
continuing to the model-interpreted persona stage.

The deterministic EVENTS -> PATTERNS pipeline is considered
human-validated for the current MVP scope.

Next architectural step: T3 / PATTERNS -> TRAITS/BELIEFS persona
interpretation.

## Phase 4/T3 — real OpenRouter dogfood and the representation-bottleneck finding

Documented in full in `docs/decisions/0015`'s final two sections. Summary:
the T3 pipeline (evidence → patterns → OpenRouter → persisted claims) was
run against a real OpenRouter API key and the operator's real persisted
corpus above (`compressionRatio/unscoped` ≈0.84, `lexicalOverlap/unscoped`
≈0.09, 5 supporting observations each) and completed successfully —
**pipeline execution confirmed working end to end.** The resulting claims
were plausible but not established by the supplied evidence (e.g.
"compression suggests efficiency/clarity" is not actually supported by a
compression-ratio number alone) — an **information-representation
bottleneck** in the two-dimensional PATTERNS layer, not a pipeline bug and
not a T3 implementation failure. This finding directly motivated Phase 5A
(`docs/decisions/0016`) — see below.

## Phase 5A — semantic delta extraction

Implemented per `docs/decisions/0016`, in response to the finding above,
and now run once against the real corpus — see "Results — first real
experiment (operator-graded)" below. Passing automated tests and a
completed real run mean the pipeline executes correctly end to end; they
do **not** by themselves mean the persona-evidence-utility hypothesis is
validated — see 0016's pre-declared acceptance criteria, which are graded
manually, and the real result below, which did not clear all of them.

### How to run it

1. Open the popup and locate the "Semantic Delta Extraction (Phase 5A —
   experimental)" panel, directly below "Traits / Beliefs (T3)".
2. Expand "Semantic delta extraction settings" and enter an OpenRouter API
   key and a model id. Per `docs/decisions/0016`, prefer a deliberately
   cheap/small model capable of reliable structured output — small-model
   viability is itself part of what this experiment is meant to report on,
   not something to route around with a stronger model.
3. Check "Enabled" and click "Save". Note this is a **separate, independent
   opt-in** from the T3 settings above it — enabling T3 does not enable
   this experiment, and vice versa.
4. Read the panel's warning line: unlike T3, this experiment sends the raw
   original AI draft and raw human final edited text of each unprocessed
   `EditEvent` to the configured model. Confirm this is acceptable before
   proceeding.
5. Click "Extract semantic deltas (Phase 5A)". This enqueues
   `extract_semantic_deltas` at `P3` — same scheduling caveat as every
   other `P3` rebuild button in this popup (`docs/decisions/0013`,
   `0014`): it only dispatches once the runtime reaches `DEEP_IDLE`
   (popup closed, ~90s of continuous foreground inactivity), so it will
   not visibly run immediately if the popup stays open. Check the Queue
   panel's `P3` count to confirm it's still pending vs. already run.
6. Once run, the panel shows: how many sources were processed, split into
   extracted vs. abstained counts, and the list of extracted
   `SemanticDeltaCandidate`s — each with its kind, observation,
   preferred/rejected (if a `contrastive_preference`), context, confidence,
   source `EditEvent` id, extractor id/model, and timestamp.
7. Running it again only processes `EditEvent`s not yet covered by a
   receipt from the *same* configured extractor/model — already-processed
   sources (including ones that correctly abstained) are not resubmitted.
   Changing the model id and re-running will reprocess every source under
   the new model.

### Human-operator grading protocol (per `docs/decisions/0016`)

For each extracted `SemanticDeltaCandidate`, the operator grades it:

- **SUPPORTED** — directly justified by the original → final transformation.
- **PARTIALLY_SUPPORTED** — a real observation, but with interpretation not
  established by the source evidence.
- **UNSUPPORTED** — speculative, not established by the edit pair.

For each source `EditEvent` (regardless of outcome), the operator also
notes:

- **MISSED_SIGNAL** — the edit contains an important semantic
  preference/behavior difference the extractor failed to represent.

And overall, the operator judges the central, non-checkbox question:
whether the semantic candidates preserve materially more persona-relevant
information than the existing `compressionRatio`/`lexicalOverlap`
representation — not just a differently-worded restatement of "the text got
shorter."

### Results — first real experiment (operator-graded)

Run against the real corpus of 5 Turkish `EditEvent`s (AI-generated source
text + the operator's actual final edited text), after the strict
structured-output schema compatibility fix (see 0016's "Post-implementation
fix" section) was in place.

**Configuration.**

| | |
|---|---|
| Provider | OpenRouter |
| Model configured | `openai/gpt-4o-mini` |
| Sources processed | 5 |
| Sources with extracted candidates | 5 |
| Sources abstained | 0 |
| Total `SemanticDeltaCandidate`s produced | 15 |

The network run completed successfully — every one of the 5 sources
reached the model and produced a schema-valid response; no HTTP failures,
no malformed-response errors, no abstentions on this particular corpus (a
zero-abstention result on 5 sources does not by itself confirm abstention
quality — no cosmetic/grammar-only edit happened to occur naturally in
this real corpus; the synthetic cosmetic-edit fixture in the automated
test suite remains the guard for that case). This confirms **pipeline
execution** end to end in the real unpacked extension, against real
persisted evidence and a real external model.

**Grading (per candidate, human-operator-assigned; all 15 candidates
graded, none auto-graded):**

| Grade | Count | % |
|---|---|---|
| SUPPORTED | 10 | 66.7% |
| PARTIALLY_SUPPORTED | 4 | 26.7% |
| UNSUPPORTED | 1 | 6.7% |

**Criterion-by-criterion result, against the pre-declared thresholds in
`docs/decisions/0016` (not reinterpreted or weakened after seeing this
result):**

```text
PIPELINE EXECUTION       PASS
INFORMATION GAIN         PASS
COVERAGE                 PASS / BORDERLINE
GROUNDEDNESS             FAIL (66.7% vs required >=80%)
SMALL-MODEL VIABILITY    PROMISING / NOT YET VALIDATED

PHASE 5A                 ITERATE
```

- **Groundedness — FAIL.** 66.7% `SUPPORTED` vs. the required ≥80%.
  `PARTIALLY_SUPPORTED` (26.7%) does not count toward this threshold, per
  the pre-declared rule. The threshold itself was not changed after seeing
  this result.
- **Coverage — PASS / BORDERLINE.** Manual inspection found approximately
  one important `MISSED_SIGNAL` in the 5-source corpus, within the
  pre-declared "no more than 1" bound. The clearest example: an apology
  edit where the operator's final text removed/reframed meaningful
  material — including reconciliation/closure language and a sharper
  semantic change in how the underlying behavior was explained — that the
  extractor did not fully represent. Recorded as borderline given the
  corpus is only 5 pairs; not treated as a clean pass.
- **Information gain — PASS.** The prior deterministic representation
  (`compressionRatio`, `lexicalOverlap` — see the Phase 4/T3 finding
  above) reduced these same edits to two scalar measurements that were
  technically valid but did not preserve their meaning. Semantic-delta
  extraction recovered substantially richer, human-readable information
  from the same underlying edits, including observable transformations
  around: prioritizing an MVP/core-value proof before feature expansion;
  moving from continued iteration toward shipping and collecting real user
  feedback; turning neutral recommendations into more direct/blunt ones;
  formal → informal/conversational language shifts; adding personal
  experience to advice; strengthened criticism; and changes in how
  apologies/explanations were framed. None of these distinctions are
  recoverable from compression ratio or lexical overlap alone. **This does
  not prove persona reconstruction, stable traits, or downstream persona
  fidelity** — it is evidence about the semantic-evidence-extraction step
  only, which is all Phase 5A tests.
- **Small-model viability — PROMISING / NOT YET VALIDATED.** `gpt-4o-mini`
  extracted many meaningful Turkish semantic differences from the real
  corpus without a stronger/more expensive model being substituted in.
  However, because groundedness missed its threshold, small-model
  viability is not marked fully validated — the open question is whether
  the shortfall is a model-capability limit or a prompt/extraction-design
  issue (see failure mode below), which a small model alone cannot answer.
- **Model-reported confidence.** Values clustered heavily around
  ≈0.80–0.95 across the 15 candidates. Per `docs/decisions/0016`, this
  remains documented strictly as *extraction* confidence — not calibrated
  persona confidence or trait stability — and this run gives no reason to
  revisit that distinction.

**Important failure mode observed (recorded as a finding, not yet as a
fix — a separate follow-up task will decide how to address it; no
extractor/prompt/schema change was made in response to this run).** The
main quality problem was not an absence of semantic information — it was
the extractor sometimes conflating two different things:

1. information actually introduced, removed, strengthened, weakened, or
   reframed by the human's edit, versus
2. meaning that was already substantially present in the AI-generated
   source and merely remained (or was rephrased) in the human's final
   text.

Example class of failure: if the AI source already says "avoid adding more
features and test with users," and the human final says "don't
unnecessarily expand scope; ship the MVP and test it," the extractor may
emit "prefers avoiding feature expansion" as a semantic delta. That may
describe the final text accurately, but the preference was already present
in the AI draft — it cannot automatically be attributed to the human edit
as newly observed evidence. This distinction appears to be the primary
driver of the groundedness shortfall above.

**Overall interpretation.** This result did **not** provide a reason to
reject the underlying Phase 5A hypothesis. It produced evidence that
meaningful persona-relevant semantic information is present in human edits
and can be recovered even by a relatively small/cheap model — a real,
positive information-gain finding directly answering the question that
motivated Phase 5A (`docs/decisions/0015`'s T3 representation-bottleneck
finding). The current limitation is extraction **precision**: reliably
distinguishing information genuinely contributed by the human's
transformation from meaning already present in the AI-generated source.
This is promising evidence from a single, very small (5-pair) real corpus
— not proof that HDNA can reconstruct a persona, and not a basis for
claiming groundedness is solved. Phase 5A status: **ITERATE** — a
follow-up task will address the extraction-precision failure mode
separately; no extractor/prompt/schema/architecture change was made as
part of recording these results.

### Trial 1 — transformation-grounding extraction instruction

**Status: REAL RESULT RECORDED — ITERATE. Aggregate groundedness did NOT
improve over baseline/Trial 0.** The baseline/Trial 0 result above is
preserved unchanged. Full rationale, exact instruction wording changes,
versioning detail, and the full real-result writeup are in
`docs/decisions/0016`'s "Trial 1" section; this is the short
operator-facing summary.

**What changed (one controlled variable only).** The baseline's
groundedness shortfall (66.7% vs. required ≥80%) traced to the extractor
sometimes attributing to the human's edit meaning already present in the
AI-drafted original. Trial 1 changes only the extraction instruction sent
to `openai/gpt-4o-mini` (same model, same 5 real `EditEvent`s, same
OpenRouter provider, same schema, same candidate kinds, same receipt
mechanism, same acceptance thresholds): it grounds every candidate in the
ORIGINAL → FINAL transformation specifically — meaning already true of the
ORIGINAL ("preserved") is explicitly disqualified from producing a
candidate; only meaning added, removed, or materially transformed by the
edit may. A mandatory counterfactual check ("would this still be true
having seen only the ORIGINAL?") is applied before every candidate. The
instruction is fully language-general — no rule specific to Turkish,
English, or any other language was introduced.

**How to rerun the same 5 EditEvents under Trial 1:**

1. Confirm the popup's semantic-delta-extraction settings still have
   `openai/gpt-4o-mini` configured and a valid OpenRouter API key saved.
2. Click "Extract semantic deltas (Phase 5A)" again — no other UI change
   is needed.
3. Trial 1's extractor identity (`providerId`) differs from baseline's, so
   none of the 5 sources' baseline receipts match it; all 5 are
   automatically reprocessed under the new instruction. **You do not need
   to, and should not, manually clear the receipt store.**
4. **Verifying Trial 1 actually reprocessed the 5 sources (rather than
   being silently skipped by stale baseline receipts):** in the results
   panel, each newly-produced `SemanticDeltaCandidate`'s per-candidate
   `extractorId`/`extractorVersion` line will read
   `openrouter/transformation-grounded-v1` / `openai/gpt-4o-mini` —
   visibly different from baseline's plain `openrouter` /
   `openai/gpt-4o-mini`. Seeing the new `extractorId` string confirms Trial
   1's instruction (not a skipped baseline receipt) produced the result.
5. Grade the resulting candidates with the **exact same rubric and the
   exact same thresholds** as baseline (`SUPPORTED`/`PARTIALLY_SUPPORTED`/
   `UNSUPPORTED` per candidate, `MISSED_SIGNAL` per source, ≥80%
   `SUPPORTED` required, ≤1 `MISSED_SIGNAL` allowed) — do not adjust the
   threshold based on the outcome.

### Trial 1 real result (operator-graded)

Receipts confirmed all 5 sources were reprocessed under
`extractorId: "openrouter/transformation-grounded-v1"`,
`extractorVersion: "openai/gpt-4o-mini"`, `outcome: "extracted"` for all 5
— not skipped by stale baseline receipts.

| | Trial 0 (baseline) | Trial 1 |
|---|---|---|
| Candidates | 15 | 15 |
| SUPPORTED | 10 (66.7%) | 10 (66.7%) |
| PARTIALLY_SUPPORTED | 4 (26.7%) | 4 (26.7%) |
| UNSUPPORTED | 1 (6.7%) | 1 (6.7%) |
| Groundedness vs. ≥80% threshold | FAIL | FAIL |

**Aggregate groundedness did not improve.** Trial 1 does not clear the
pre-declared ≥80% `SUPPORTED` threshold, same as Trial 0 — recorded
plainly: Trial 1 did not pass.

**Qualitative finding.** Manual inspection found Trial 1 more often
expressed observations as directional ORIGINAL → FINAL transformations
rather than merely describing properties of the final text (e.g.
process-oriented validation → explicit core-value validation; an existing
explanation being removed/replaced by a different explanation; a generic
rest recommendation gaining a concrete consequence/personal observation;
testing language transformed into explicit shipping-plus-feedback
language) — evidence the instruction did affect behavior — but this was
**not sufficient to move the aggregate score**. Do not overstate this on a
5-pair corpus.

**Remaining failure classes** (full detail in `docs/decisions/0016`'s
Trial 1 section) that directly motivated Trial 2: (1) preserved and
changed meaning still mixed within one candidate, dragging it down to
`PARTIALLY_SUPPORTED`; (2) overlapping/redundant candidates describing
substantially the same underlying edit; (3) removal sometimes
over-interpreted as motivation rather than recorded as plain removal.

### Trial 2 — deterministic evidence localization + atomic semantic deltas

**Status: REAL RESULT RECORDED — ITERATE. First quantitative groundedness
improvement (66.7% → 70.6%), still below ≥80%.** See "Trial 2 real result"
below for the full writeup; full parallel detail is in
`docs/decisions/0016`'s "Real Trial 2 result" section. Full design,
algorithm choice (a word/token-level adaptation of Conijn et al.'s
restricted-Damerau-Levenshtein revision
classification), and academic grounding are in `docs/decisions/0016`'s
"Trial 2" section; this is the short operator-facing summary.

**What changed.** Ahead of semantic interpretation, a new deterministic,
language-general localization step (`computeRevisionDiff`) compares
ORIGINAL and FINAL and marks which spans were preserved, removed, added,
replaced, or reordered — purely structural, never a semantic judgment. The
full ORIGINAL and FINAL texts are still sent in full, unchanged; the
localization is added context, not a replacement. The extraction
instruction retains every Trial 1 rule unchanged and adds: the
localization is WHERE-only, not WHAT (must still be interpreted against
full context); each candidate must be **atomic** (one independently
supportable transformation, not a bundle of supported + unsupported
meaning); **redundant** candidates describing the same underlying
transformation should be collapsed to the clearest one (local,
per-`EditEvent` only — no cross-user/global dedup, no embeddings); and
**removal/replacement discipline** — removal/replacement itself is
observable, but a motivation for it is not, unless the FINAL text states
it directly.

**How to rerun the same 5 EditEvents under Trial 2:**

1. Confirm the popup's settings still have `openai/gpt-4o-mini` and a
   valid OpenRouter API key. No UI change was made for Trial 2.
2. Click "Extract semantic deltas (Phase 5A)" again.
3. Trial 2's extractor identity differs from both Trial 0's and Trial 1's,
   so all 5 sources are automatically reprocessed — no manual receipt
   clearing needed.
4. **Verifying the results belong to Trial 2:** each candidate's
   `extractorId`/`extractorVersion` line should read
   `openrouter/evidence-localized-v2` / `openai/gpt-4o-mini` — distinct
   from Trial 0's `openrouter` and Trial 1's
   `openrouter/transformation-grounded-v1`.
5. Grade with the exact same rubric/thresholds as Trial 0 and Trial 1.
6. Record two separate results, per `docs/decisions/0016`'s explicit
   framing — do not conflate them: **(a)** did evidence localization +
   atomicity qualitatively reduce the three remaining failure classes
   above, relative to Trial 1? **(b)** did aggregate groundedness reach
   ≥80% `SUPPORTED`? Trial 2 may show real improvement on (a) without
   passing (b).

### Trial 2 real result (operator-graded)

Configuration held controlled: same 5 `EditEvent`s, OpenRouter,
`openai/gpt-4o-mini`, extractor `openrouter/evidence-localized-v2`.

| | Trial 0 | Trial 1 | Trial 2 |
|---|---|---|---|
| Candidates | 15 | 15 | 17 |
| SUPPORTED | 10 (66.7%) | 10 (66.7%) | 12 (70.6%) |
| PARTIALLY_SUPPORTED | 4 (26.7%) | 4 (26.7%) | 3 (17.6%) |
| UNSUPPORTED | 1 (6.7%) | 1 (6.7%) | 2 (11.8%) |
| Groundedness vs. ≥80% threshold | FAIL | FAIL | FAIL |

**First quantitative groundedness improvement: 66.7% → 70.6% (+3.9
points).** Still below the ≥80% threshold — **Trial 2 did not pass Phase
5A.** `PARTIALLY_SUPPORTED` fell (26.7% → 17.6%, consistent with the
evidence-localization/atomicity objective), but `UNSUPPORTED` *rose* (6.7%
→ 11.8%) — both directions recorded, not only the favorable one. With only
5 `EditEvent`s (17 candidates), no statistical-significance or
generalization claim is made.

**Newly exposed failure class: localized textual change mistaken for
meaningful semantic evidence.**

```text
TEXTUAL INTERVENTION != SEMANTIC CHANGE != PERSONA-RELEVANT EVIDENCE
```

Clearest example: the deterministic layer correctly localized a
replacement (`davranışlarına` → `hareketine`); the extractor interpreted
this as narrowing from broader "behavior" to more specific "actions" —
graded **UNSUPPORTED**. The textual change is real; the claimed semantic
narrowing is not sufficiently supported by it. A second UNSUPPORTED case
was an interpretation/comparison error, not a localization failure: a
candidate claimed the human described the current version as better
"without explicitly acknowledging prior issues," but the human's FINAL
text explicitly wrote "diğeri karman çorman bişeydi" — an explicit
acknowledgment of prior issues, directly contradicting the claim.

**Remaining `PARTIALLY_SUPPORTED` pattern (3 cases):** meaning mixed with
meaning substantially present in ORIGINAL; correctly-detected
removal/reframing with unsupported added motivation; observable
explanation changes reframed as psychology (e.g. "minimizing the impact,"
"external justification" — went beyond what the edit itself established).
The boundary to keep enforcing:

```text
observable semantic transformation != psychological explanation for the transformation
```

**Positive observations (corpus observations only, not generalization
evidence):** removal of "Bence" ("I think") correctly read as a more
assertive/direct formulation — illustrating `textual change magnitude !=
semantic/pragmatic change magnitude`; **not to be turned into a
Turkish-specific extraction rule.** Other clean cases: explicit
introduction of validating the project's core value before further
development; feature-expansion optimism replaced by explicit skepticism
about demand/relevance; more direct rest advice; addition of personal
experience about taking breaks.

**Conservative conclusion:** Trial 2 produced the first quantitative
groundedness improvement (66.7% → 70.6%) and reduced partially-supported
candidates (26.7% → 17.6%), but unsupported candidates increased (6.7% →
11.8%). Deterministic evidence localization appears useful in this small
experiment but is not sufficient: correctly identifying *where* a human
edited text does not establish that every localized edit represents a
meaningful semantic delta or persona-relevant signal.

```text
localization appears useful
but localization is not sufficient
```

No claim of causality, statistical significance, cross-language
generalization, or persona-reconstruction validation is made.

### Current best Phase 5A result

```text
70.6% SUPPORTED (Trial 2)
Acceptance threshold: >=80%
Phase 5A = ITERATE
```

Trial 0 and Trial 1's results above remain visible, not overwritten. Trial
3 is not designed or implemented as of this writing.
