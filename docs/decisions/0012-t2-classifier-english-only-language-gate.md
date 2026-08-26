# 0012 — Fix: HeuristicTinyClassifier saturated/biased on non-English text; added a language-applicability gate

## Decision

`HeuristicTinyClassifier` now checks `isLikelyEnglish(text)` before applying
its formality/directness heuristics, and **abstains** (omits the dimension
from `scores`/`confidence` entirely, rather than emitting a fabricated
neutral value) when the check fails. `isLikelyEnglish` is a non-ASCII-letter-
ratio check (threshold 2%): genuine English prose is overwhelmingly plain
ASCII a-z; most other Latin-script languages (Turkish, French, German, ...)
are not. This is deliberately not general language identification — a
documented scope boundary, not an attempt to solve language ID.

## Why the decision was made

Operator report: after processing 35 real Turkish writing samples through the
full pipeline (35/35 T2 classified, 35/35 embedded, P2 queue drained),
`T2Profile.directness` read exactly 100% across all samples, while
`formality` read 76%. Pipeline health (queue, aggregation, atomicity) was
confirmed fine; the operator asked for the classifier itself to be
investigated, no queue/aggregation changes, no "patch in a few Turkish
words," and an explicit check of whether the same assumption biases
formality.

### Root cause: directness

`scoreDirectness()`'s entire signal is `HEDGE_PHRASES`, an English-only list
("maybe", "perhaps", "I think", "sort of", ...). For any text with zero
matches — which is essentially guaranteed for Turkish, since none of those
English phrases occur in Turkish — the formula
`clamp(1 - hedgeRate * 8, 0, 1)` collapses to a **constant** `1.0`
regardless of the text's actual directness. This is not "no signal," it's a
confidently wrong signal: `confidenceFromWordCount()` only scales with word
count, not with whether the lexicon is applicable to the text's language, so
these wrong readings carried full weight into the confidence-weighted
aggregate — explaining the exact, saturated 100% the operator observed.

### Root cause: formality (materially biased, not saturated)

Checked per the operator's explicit request. Two English-specific components
both push formality upward for Turkish, without saturating to a constant the
way directness did:

1. **Contraction detection** (`CONTRACTION_PATTERN`, English-only:
   "don't", "can't", "I'm", ...) never matches Turkish, silently zeroing out
   a real informality signal that would otherwise pull the score down.
2. **Word-length calibration** (`(meanWordLength - 3) / 5`, mapped 3–8
   characters to 0–1) was implicitly tuned against English morphology.
   Turkish is agglutinative — suffixes stack onto word stems (case,
   possessive, plural, etc.) — so mean word length runs structurally higher
   than English at *any* register, independent of actual formality. This
   confound alone pushes the word-length half of the formula toward
   "formal" for Turkish regardless of how casually someone is actually
   writing.

Together these explain a real, systematic upward bias (consistent with the
observed 76%, well above the 50% neutral midpoint) — smaller in magnitude
than directness's total collapse, but the same underlying cause: English-
specific lexicon/calibration silently misapplied to another language.

## Alternatives considered

1. Add Turkish-specific hedge words/contractions — explicitly rejected by
   the operator ("do not simply patch in a few Turkish words"): doesn't
   generalize to the stated goal of "multilingual/unknown-language
   evidence," and each additional language would need its own hand-built
   lexicon and calibration, indefinitely.
2. Build a real language-identification step (e.g. a small language-ID
   model or n-gram language model) — rejected: would introduce exactly the
   kind of new dependency this project has repeatedly declined to add
   without an explicit operator decision (see 0009, 0010, 0011), for a
   problem a much simpler deterministic signal already solves well enough.
3. Function-word-ratio detection (checking for common English closed-class
   words: "the", "is", "and", ...) — tried first, rejected after testing:
   formal-register English has *lower* function-word density than casual
   English (a real, known stylometric effect), so a formal English fixture
   from this project's own test suite scored only ~9% — uncomfortably close
   to the threshold needed to reliably exclude non-English text, risking
   false negatives on exactly the register the classifier exists to
   distinguish. The non-ASCII-letter-ratio approach has no such register
   confound (formal and casual English both score ~0%), verified against
   representative fixtures before implementation (see chat record).
4. Return a neutral `{score: 0.5, confidence: 0}` value at the classifier
   level instead of omitting the dimension — considered, but omission is
   more correct: `TinyClassifierResult.scores`/`.confidence` are already
   `Partial<Record<T2Dimension, number>>` specifically to express "not
   computed" (the same mechanism the SPEC_RESERVED dimensions already use).
   Passing through a confidence-0 value would still increment
   `T2DimensionAggregate.sampleCount` in `applyTraitScore` (a real latent
   issue: `sampleCount` currently increments even at confidence 0,
   independent of this fix), misleadingly counting a non-observation as a
   "sample" in the transparency UI. Full omission avoids that without
   touching `t2-profile.ts` at all — the existing
   `if (score === undefined || confidence === undefined) continue;` guard
   in `applyTraitScore` and the existing `Object.keys(trait.scores)`
   iteration in the Phase 4 pattern compiler both already do the right
   thing for an omitted dimension, with zero changes needed downstream.

## Research/evidence used

Not applicable as an external claim — this is a bug-fix decision. The
underlying observation (agglutinative languages produce structurally longer
average word length independent of register) is a basic, uncontested fact
about Turkish morphology, not a claim requiring citation.

## What the AI system was asked to evaluate

The operator specified the investigation scope precisely (classifier only,
not queue/aggregation; explain the Turkish saturation; check formality too;
no word-list patching; preserve the swappable architecture; propose the
smallest principled fix with confidence behavior and regression tests).
Evaluated: root-caused both dimensions from the actual formulas rather than
assuming; tested three candidate detection approaches against real fixtures
before choosing (function-word ratio was tried and rejected in favor of
non-ASCII-letter ratio after measuring both against this project's existing
English test fixtures plus Turkish/French/German samples); verified the
chosen fix requires zero changes outside `t2-classifier.ts` by tracing how
`Partial<>` omission already propagates correctly through the existing
aggregation and pattern-compilation code.

## Known limitations

- `isLikelyEnglish` does not detect every non-English language — romanized
  or ASCII-only text in another language (e.g. Bahasa Indonesia written
  without diacritics) still passes the gate and would receive the same
  wrong treatment this fix addresses for Turkish. This is an intentional,
  documented scope boundary (see the function's doc comment), not an
  oversight: it directly and robustly fixes the reported case and
  generalizes to the broad class of diacritic-bearing Latin-script
  languages, without taking on general language identification.
- The pre-existing `sampleCount` increment on a confidence-0 observation in
  `applyTraitScore` (noted under Alternatives above) was not fixed here — it
  no longer matters for this specific bug because the classifier now omits
  the dimension entirely rather than passing through confidence 0, but the
  latent behavior itself remains if some future classifier ever does emit a
  real zero-confidence value.

## Current validation status

Implemented and tested in `extension/src/persona/t2-classifier.ts` and
`extension/tests/persona/t2-classifier.test.ts` /
`extension/tests/persona/trait-classifier-service.test.ts`:
- `isLikelyEnglish`: 5 tests (plain-ASCII English incl. formal register,
  casual English with contractions/emoji, Turkish, French, German, and a
  Turkish-with-English-loanword case proving robustness to code-switching).
- `scoreFormality`/`scoreDirectness`: 5 new abstention tests using real
  natural sentences (not a keyword-list patch) in Turkish, French, and
  German, plus a code-switching case for directness.
- `HeuristicTinyClassifier.classify()`: 2 new tests confirming full
  omission (`{}`, not zero-valued keys) for non-English text, and
  unaffected behavior for English text.
- `TraitClassifierService`: 1 new end-to-end regression test reproducing
  the exact reported symptom at profile-aggregate scale — 5 real Turkish
  samples through `rebuild()` (the same code path `classifyOne` uses, which
  the P2 job processor calls) leave `T2Profile.directness` and `.formality`
  both `undefined`, never created, instead of saturating.
- 189/189 tests pass (13 new), zero regressions against the existing
  English-language test fixtures, clean typecheck, clean build.
