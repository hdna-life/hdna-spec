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
