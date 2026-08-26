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

## Phase 5A — semantic delta extraction (not yet run by the operator)

Implemented per `docs/decisions/0016`, in response to the finding above.
**This section documents how to run the experiment and how results should
be recorded — the operator has not yet run it against the real corpus as of
this PR, and no grading results exist yet.** Do not treat the presence of
this section as evidence the experiment has been validated; see 0016's
pre-declared acceptance criteria, which are graded manually.

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

### Results — TODO, pending the operator's actual run

| Source EditEvent | Candidate(s) | Grade | Notes |
|---|---|---|---|
| _(not yet run)_ | | | |

Model configured: _(not yet recorded)_. Groundedness (% SUPPORTED):
_(pending)_. MISSED_SIGNAL count: _(pending)_. Information-gain judgment:
_(pending)_. Small-model viability verdict: _(pending)_.

This table is intentionally left as a TODO rather than filled with
fabricated results — per `docs/decisions/0016`, passing automated tests
means the experiment is ready to run, not that the persona-evidence-utility
hypothesis has been validated. This section should be updated with the
operator's real findings once the run happens.
