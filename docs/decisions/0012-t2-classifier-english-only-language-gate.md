# 0012 — Fix: HeuristicTinyClassifier saturated/biased on non-English text; added a language-applicability gate

## Decision

`HeuristicTinyClassifier` now checks `isLikelyEnglish(text)` before applying
its formality/directness heuristics, and **abstains** (omits the dimension
from `scores`/`confidence` entirely, rather than emitting a fabricated
neutral value) when the check fails. `isLikelyEnglish` requires **two**
independent signals to both hold:

1. Non-ASCII letter ratio ≤ 2% (genuine English prose is overwhelmingly
   plain ASCII a-z; Turkish, French, German, and most other Latin-script
   languages are not).
2. English closed-class function-word density ≥ 5% (articles, pronouns,
   auxiliary/modal verbs, prepositions, conjunctions, and their common
   contractions — "the," "is," "don't," "I'm," ...).

This is deliberately not general language identification — a documented
scope boundary, not an attempt to solve language ID.

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
matches — essentially guaranteed for Turkish, since none of those English
phrases occur in Turkish — the formula `clamp(1 - hedgeRate * 8, 0, 1)`
collapses to a **constant** `1.0` regardless of the text's actual
directness. This is not "no signal," it's a confidently wrong signal:
`confidenceFromWordCount()` only scales with word count, not with whether
the lexicon is applicable to the text's language, so these wrong readings
carried full weight into the confidence-weighted aggregate — explaining the
exact, saturated 100% the operator observed.

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
   than English at *any* register, independent of actual formality.

Together these explain a real, systematic upward bias (consistent with the
observed 76%, well above the 50% neutral midpoint), the same underlying
cause as directness: English-specific lexicon/calibration silently
misapplied to another language.

## Revision history within this decision

**First version** (implemented, then explicitly rejected by the operator
before merge): `isLikelyEnglish` used only the non-ASCII letter ratio
signal. The operator did not accept this as the final principled fix and
directed that an ASCII-only Turkish regression test be added — predicting,
correctly, that it would expose a gap.

**The gap, confirmed**: Turkish typed without diacritics (extremely common
in practice — non-Turkish keyboards, texting habits) is indistinguishable
from English by character content alone. `"Bugün hava çok güzeldi"` becomes
`"Bugun hava cok guzeldi"` — 0% non-ASCII letters, identical to genuine
English by that one signal. The character-only gate would have silently let
this case straight through to the same saturation/bias bug it was built to
prevent.

**Second version** (this decision, as merged): added the English
function-word-density signal, required jointly with the non-ASCII check
(both must hold). Function words are a standard, robust language
discriminator independent of diacritics — Turkish words don't happen to
collide with English closed-class words the way Turkish's Latin-alphabet
letters can overlap with plain ASCII. Verified against the full fixture set
(this file's existing tests plus Turkish/French/German, diacritic and
ASCII-stripped, plus a code-switched case) before implementation:

```
English casual        nonAscii=0.0%   functionWord=42.9%
English formal        nonAscii=0.0%   functionWord=9.1%
English hedge         nonAscii=0.0%   functionWord=50.0%
English direct        nonAscii=0.0%   functionWord=42.9%
Turkish (diacritics)  nonAscii=22.4%  functionWord=0.0%
Turkish (ASCII-only)  nonAscii=0.0%   functionWord=0.0%
Turkish + loanword    nonAscii=12.2%  functionWord=0.0%
French                nonAscii=8.8%   functionWord=0.0%
German                nonAscii=5.7%   functionWord=0.0%
```

Every real English fixture clears 9%+ function-word density; every
non-English fixture (diacritic or ASCII-only) sits at exactly 0%. A 5%
floor sits comfortably in that gap with margin on both sides. Requiring
*both* signals removes the tension a function-word-only approach had on its
own (see Alternatives, #3): the non-ASCII check needs no register-sensitive
threshold, and the function-word check only has to clear a low floor once,
not carry the whole decision by itself.

## Alternatives considered

1. Add Turkish-specific hedge words/contractions — explicitly rejected by
   the operator ("do not simply patch in a few Turkish words"): doesn't
   generalize to "multilingual/unknown-language evidence," and each
   additional language would need its own hand-built lexicon indefinitely.
2. Build a real language-identification step (a small language-ID model or
   n-gram language model) — rejected: would introduce exactly the kind of
   new dependency this project has repeatedly declined to add without an
   explicit operator decision (see 0009, 0010, 0011), for a problem two
   cheap deterministic signals already solve well enough.
3. Function-word-ratio alone, with no non-ASCII check — tried and rejected
   on its own in the first investigation pass: formal-register English has
   *lower* function-word density than casual English (a real, known
   stylometric effect) — a formal English fixture scored only ~9%,
   uncomfortably close to a workable non-English threshold on its own. It
   works reliably only in combination with the non-ASCII check (this
   decision's final design), where it only needs to clear a low floor, not
   single-handedly separate every register of English from every
   non-English language.
4. Non-ASCII-letter-ratio alone — this decision's *first* implementation.
   Operator-rejected before merge specifically because it cannot detect
   non-English text that happens to be typed in plain ASCII (diacritics
   omitted) — confirmed by the requested regression test. Superseded by the
   combined two-signal design above.
5. Return a neutral `{score: 0.5, confidence: 0}` value at the classifier
   level instead of omitting the dimension — considered, but omission is
   more correct: `TinyClassifierResult.scores`/`.confidence` are already
   `Partial<Record<T2Dimension, number>>` specifically to express "not
   computed" (the same mechanism the SPEC_RESERVED dimensions already use).
   Passing through a confidence-0 value would still increment
   `T2DimensionAggregate.sampleCount` in `applyTraitScore` (a real latent
   issue: `sampleCount` currently increments even at confidence 0,
   independent of this fix), misleadingly counting a non-observation as a
   "sample" in the transparency UI. Full omission avoids that without
   touching `t2-profile.ts` at all.

## Research/evidence used

Not applicable as an external claim — this is a bug-fix decision. The
underlying observations (agglutinative languages produce structurally
longer average word length independent of register; closed-class function
words are rarely borrowed across languages) are basic, uncontested facts,
not claims requiring citation.

## What the AI system was asked to evaluate

The operator specified the investigation scope precisely (classifier only,
not queue/aggregation; explain the Turkish saturation; check formality too;
no word-list patching; preserve the swappable architecture; propose the
smallest principled fix with confidence behavior and regression tests), then
— after the first fix was proposed — explicitly declined to accept it as
final and directed an ASCII-only Turkish regression test specifically to
surface its weakness. That test did surface it, exactly as predicted. The
system's job on the second pass was to diagnose why the character-only
signal was insufficient, find a complementary signal that closes the gap
without reintroducing the register-confound problem the function-word
approach had shown on its own, and verify the combined design against the
full fixture set before writing code (rather than iterating fixes against
the test suite after the fact).

## Known limitations

- `isLikelyEnglish` still does not attempt general language identification.
  Non-English text that is both ASCII-only *and* happens to reuse enough
  English function words (rare, but conceivable for heavily code-mixed
  text) could still pass. This is a documented, accepted boundary — not
  every conceivable adversarial case, but a fix that closes the concretely
  demonstrated gap (ASCII-only Turkish) and generalizes soundly to any
  language that is either diacritic-bearing or lexically distinct from
  English's closed-class vocabulary, which covers the realistic case.
- The pre-existing `sampleCount` increment on a confidence-0 observation in
  `applyTraitScore` (see Alternatives, #5) was not fixed here — it no
  longer matters for this specific bug because the classifier omits the
  dimension entirely rather than passing through confidence 0, but the
  latent behavior itself remains if some future classifier ever does emit a
  real zero-confidence value.

## Current validation status

Implemented and tested in `extension/src/persona/t2-classifier.ts`,
`extension/tests/persona/t2-classifier.test.ts`, and
`extension/tests/persona/trait-classifier-service.test.ts`:
- `isLikelyEnglish`: 8 tests — plain-ASCII English incl. formal register and
  short/terse text, casual English with contractions/emoji, Turkish
  (diacritic and ASCII-only), French, German, and a Turkish-with-
  English-loanword case.
- `scoreFormality`/`scoreDirectness`: 7 abstention tests using real natural
  sentences (not a keyword-list patch) — Turkish (diacritic and
  ASCII-only), French, German, and a code-switching case for directness.
- `HeuristicTinyClassifier.classify()`: 3 tests confirming full omission
  (`{}`, not zero-valued keys) for non-English text including the
  ASCII-only case, and unaffected behavior for English text.
- `TraitClassifierService`: 2 end-to-end regression tests reproducing the
  reported symptom at profile-aggregate scale — real Turkish samples
  (diacritic, and separately ASCII-only) through `rebuild()` (the same code
  path `classifyOne` uses, which the P2 job processor calls) leave
  `T2Profile.directness` and `.formality` both `undefined`, never created,
  instead of saturating.
- One pre-existing test's fixture (`'word '.repeat(25)`, used only to check
  that confidence saturates with word count) was replaced with a real
  20-word English sentence — the repeated-token fixture is not
  representative text and is correctly rejected by the function-word-
  density check; the replacement preserves the test's original intent
  (confidence reaches exactly 1 at the 20-word saturation point).
- 195/195 tests pass (19 new since the pre-fix baseline), zero regressions
  against existing English-language fixtures, clean typecheck, clean build.
