# Phase 5A task/lore contract — v3

**Status:** versioned specialization contract for Trial 4
(`docs/decisions/0017`). This is the *only* document Trial 4's dataset
generation and training pipeline may treat as ground truth for what the
model should learn — it exists specifically so Trial 4 does not become "a
second, uncontrolled source of truth" about HDNA (Operator Decision 10).

**Supersedes `task-contract.v2.md`.** v1 and v2 are preserved unchanged,
not deleted or edited in place, per this document's own versioning rule
below. v3's substantive change from v2 is the new §2.2 below (the
observable-behavior dimension axis) — see "Changelog from v2" at the end
of this file for exactly what changed and why. This is still Phase 5A
Trial 4 / Test 1 — v3 is a redesign of Test 1's judging contract, not a
new phase and not Test 2.

**Traceability.** As with v1/v2, every rule below is either a direct
restatement of an existing HDNA specification/decision, a directly
observed Phase 5A failure class, or (for §2.2 only, new in v3) an
explicit operator decision made for Test 1's redesign. Sources, by rule,
carry over unchanged from v2 (see that file) plus:

- **New in v3:** the two-axis distinction (semantic/practical relation
  vs. observable behavioral/expression change) and the 15-dimension
  observable-behavior taxonomy (§2.2) — an explicit operator decision for
  Test 1's redesign, not drawn from Trial 0-3 evidence (which never
  isolated expression-only changes as a *tracked, structured* output —
  v2's §2.1 identified that expression changes could make a verdict
  `meaning_transformed`, but did not give the judge a way to record an
  expression change that does NOT change the verdict at all).

**Versioning.** This is `v3`. Any future revision (`v4`, ...) must be a
new file, not an edit to this one. Do not silently edit `v3` in place.

## 1. The task, restated (unchanged shape from v1/v2, plus one new orthogonal output)

Given one localized textual intervention:

```text
kind:            'added' | 'removed' | 'replaced' | 'reordered'
originalText:    the ORIGINAL (AI draft) span, '' if kind is 'added'
finalText:       the FINAL (human-edited) span, '' if kind is 'removed'
beforeContext:   a short excerpt of unchanged text immediately before the span
afterContext:    a short excerpt of unchanged text immediately after the span
```

produce exactly:

```text
verdict:      'no_meaningful_change' | 'meaning_added' | 'meaning_removed'
              | 'meaning_transformed' | 'uncertain'
dimensions:   zero or more { dimension, direction } pairs — see §2.2
description:  one short sentence, or null (null iff verdict is
              'no_meaningful_change' or 'uncertain')
confidence:   a number between 0 and 1
```

**`verdict` is unchanged from v1/v2 — still exactly these 5 values.**
`dimensions` is a new, ORTHOGONAL output field, not a sixth verdict value.
This is the entire task. Nothing else is in scope for this contract.

## 2. What "meaningful" means here (§2, §2.1 unchanged from v2 — see that file for full text)

A verdict other than `no_meaningful_change`/`uncertain` requires that the
localized intervention itself introduces, removes, or transforms an
observable semantic or pragmatic property. The counterfactual check from
Trial 1 remains the operative test (§2 of v2), and a changed factual
topic is still not required for a meaningful change (§2.1 of v2, on
hedging/certainty/intensity/commitment/directive-strength/qualification/
rationale/framing/scope). Both rules carry forward unchanged into v3.

### 2.2. Two related but distinct axes (NEW in v3)

Every localized intervention has **two related but distinct properties**
a judge must reason about separately:

1. **SEMANTIC / PRACTICAL RELATION** — the `verdict` field, exactly as in
   v1/v2. Did the intervention add, remove, transform, or preserve
   meaning as tested by the counterfactual check?
2. **OBSERVABLE BEHAVIORAL / EXPRESSION CHANGE** — the new `dimensions`
   field. Did the FINAL text's *directly observable expression* — tone,
   affect, certainty, directness, politeness, formality, commitment,
   scope, etc. — change relative to the ORIGINAL, independent of whether
   the proposition itself changed?

**Do not collapse these into one taxonomy.** An edit can change one axis
without the other, both together, or neither:

- Expression changes with **no** verdict change: `"The movie was good."`
  -> `"The movie was really good."` — `no_meaningful_change` (the
  proposition "the movie was good" is unchanged; "really" is intensity,
  not a new claim) **with** `dimensions: [{ expressed_affect_intensity,
  increased }]`.
- Expression changes with **no** verdict change, but the temptation to
  over-infer must be resisted: `"She is upset."` -> `"She looks upset."`
  — `no_meaningful_change` **with** `dimensions: [{ certainty, decreased
  }, { evidentiality, changed }]`. **Do NOT** record this as "the writer
  became less certain psychologically" or infer any hidden emotional
  state of the *subject* ("she"). Only the textual stance changed — the
  writer moved from a flat assertion to an evidentially-hedged one. This
  is directly observable in the wording; nothing about "she"'s actual
  emotional state is inferred.
- Both axes change together: `"Maybe I'll come tomorrow."` ->
  `"I will come tomorrow."` — `meaning_transformed` (a hedged possibility
  became a commitment — this is a genuine semantic/practical change, not
  merely expression) **with** `dimensions: [{ certainty, increased },
  { commitment, increased }]`. Dimensions are not exclusive to
  `no_meaningful_change` — they can, and often should, coexist with a
  meaning-changing verdict.
- Neither axis changes: a cosmetic correction (typo fix, punctuation)
  is `no_meaningful_change` **with** `dimensions: []`.

**Never infer a hidden emotional or psychological state.** Dimensions
describe the text's *observable expressed* properties (hence
`expressed_affect_*`, never `emotion`/`mood`/any term implying access to
someone's actual internal state). "The writer used more intense language"
is a valid observation; "the writer felt more strongly" is not — it
claims access to an internal state the text does not license.

#### The observable-behavior dimension taxonomy (closed, versioned)

Exactly these 15 dimensions (v3.0 of this taxonomy — any future addition
or removal requires a new contract version, same as the verdict enum):

| Dimension | Turkish (review UI) |
|---|---|
| `expressed_affect_valence` | Duygu yönü |
| `expressed_affect_intensity` | Duygu şiddeti |
| `directness` | Doğrudanlık |
| `politeness` | Nezaket |
| `formality` | Resmiyet |
| `certainty` | Kesinlik |
| `evidentiality` | Kanıtsal ifade |
| `commitment` | Taahhüt |
| `directive_force` | Yönlendirme gücü |
| `conditionality` | Koşul |
| `scope` | Kapsam |
| `specificity` | Özgüllük |
| `rationale` | Gerekçe |
| `factual_content` | Olgusal içerik |
| `action_or_decision` | Eylem / karar |

Exactly these 9 direction values: `increased`, `decreased`,
`more_positive`, `more_negative`, `added`, `removed`, `narrowed`,
`expanded`, `changed`. Not every direction is sensible for every
dimension (e.g. `more_positive`/`more_negative` naturally pair with
`expressed_affect_valence`; `increased`/`decreased` naturally pair with
most of the others; `added`/`removed`/`narrowed`/`expanded` naturally
pair with `scope`/`conditionality`/`specificity`/`rationale`/
`factual_content`). This document documents **sensible combinations**
below as guidance, not as a rigid enforced per-dimension mapping — a
judge is not restricted to only the "expected" pairings if a case
genuinely calls for a different one.

Sensible combinations (illustrative, not exhaustive or enforced):

- `expressed_affect_valence`: `more_positive`, `more_negative`, `changed`
- `expressed_affect_intensity`: `increased`, `decreased`
- `directness`: `increased`, `decreased`
- `politeness`: `increased`, `decreased`
- `formality`: `increased`, `decreased`
- `certainty`: `increased`, `decreased`
- `evidentiality`: `changed`, `added`, `removed`
- `commitment`: `increased`, `decreased`
- `directive_force`: `increased`, `decreased`
- `conditionality`: `added`, `removed`, `narrowed`, `expanded`
- `scope`: `narrowed`, `expanded`
- `specificity`: `increased`, `decreased`
- `rationale`: `added`, `removed`, `changed`
- `factual_content`: `added`, `removed`, `changed`
- `action_or_decision`: `added`, `removed`, `changed`

**Cardinality rules:**

- `no_meaningful_change` MAY have a non-empty `dimensions` array (the
  primary new capability this axis adds — see worked examples A/B below).
- `uncertain` — for this first Test 1 pass, keep it simple: `uncertain`
  always has `dimensions: []`. Do not attempt dimension judgments when
  the verdict itself is uncertain.
- `meaning_added`/`meaning_removed`/`meaning_transformed` should normally
  carry at least one dimension (a meaning change is very often
  accompanied by an observable expression shift), but this is guidance,
  not a hard requirement — a rare case can legitimately have `[]`.
- No duplicate dimensions within one judgment (each `dimension` value
  appears at most once in the array).
- Zero, one, or several dimensions are all valid.

## 3. Worked examples (A-E)

These are the canonical calibration examples for Trial 4 v3 generation
and review — both the generator and any human reviewer should agree with
these exact verdict/dimension assignments.

**A.** `"The movie was good."` -> `"The movie was really good."`
`verdict: no_meaningful_change`, `dimensions: [{ expressed_affect_intensity, increased }]`
The proposition is unchanged (counterfactual check: "the movie was good"
was already true of the original); intensity of the assertion increased.

**B.** `"She is upset."` -> `"She looks upset."`
`verdict: no_meaningful_change`, `dimensions: [{ certainty, decreased }, { evidentiality, changed }]`
The writer's assertional stance softened from direct assertion to
appearance-based inference. **Do not** record this as the subject's
psychological state changing — only the textual stance changed.

**C.** `"Maybe I'll come tomorrow."` -> `"I will come tomorrow."`
`verdict: meaning_transformed`, `dimensions: [{ certainty, increased }, { commitment, increased }]`
A hedged possibility became a firm commitment — this passes the
counterfactual check (the commitment was NOT already true of the
original) and is a genuine semantic/practical change, with observable
dimensions that coexist with it.

**D.** `"You should consider running the tests before merging."` ->
`"Run the tests before merging."`
`verdict: meaning_transformed`, `dimensions: [{ directive_force, increased }]`
(Carried forward from v2 §2.1's worked example — directive strength
shifted from soft suggestion to imperative; this is now expressed with
the v3 dimension vocabulary instead of prose-only.)

**E.** `"The report is due Friday."` -> `"The report is due  Friday."`
(a stray double-space correction — a purely cosmetic edit)
`verdict: no_meaningful_change`, `dimensions: []`
Neither axis changed. Not every edit carries an expression shift — do
not force a dimension onto a genuinely cosmetic change merely because
the text differs. This is the counterpart to A/B/C/D: `dimensions: []`
is just as valid and expected an answer as a non-empty array.

## 4. What must NOT be produced (unchanged from v2, plus one addition)

All bullets from v2 §3 carry forward unchanged (do not attribute
pre-existing meaning; do not infer motivation/psychology; do not use
diff magnitude or unchanged topic as evidence; do not rely on
language-specific surface form; do not invent a contradicting
comparison). New in v3:

- **Do not infer a hidden emotional/psychological state as a dimension
  judgment.** `expressed_affect_valence`/`expressed_affect_intensity`
  describe the text's expressed affect, never the subject's or writer's
  actual internal emotional state (see §2.2's worked example B). This is
  the dimension-axis specific instance of the same "no persona/
  psychology inference from one observation" boundary v1/v2 already
  establish for the verdict axis.

## 5. Kind-specific notes (unchanged from v2)

See v2 §4 — `'replaced'`/`'added'`/`'removed'`/`'reordered'` notes carry
forward unchanged; they govern the `verdict` axis and remain fully valid
in v3. The dimension axis is judged the same way regardless of `kind`.

## 6. Abstention is correct, not a failure (unchanged from v2)

See v2 §5 — carries forward unchanged. Note additionally: an empty
`dimensions: []` array is its own form of correct abstention on the
expression axis, exactly as `no_meaningful_change`/`uncertain` are
correct abstentions on the verdict axis (worked example E above). Do not
generate or accept training examples that pressure the model toward
always finding a dimension shift.

## 7. What this contract explicitly does not cover (unchanged from v2)

See v2 §6 — persona/trait aggregation, repeated-evidence reasoning,
cross-intervention comparison, retrieval, and "useful for persona
reconstruction" reasoning remain out of scope. The dimension axis
describes **one intervention's own observable expression**, never a
pattern across interventions — a single `dimensions` judgment is not
itself evidence of a persona trait.

## Changelog from v2

**v3 is a Test 1 redesign, not an architecture or scope change** — it
adds one orthogonal output field (`dimensions`) to the existing 4-field
output shape, without touching the verdict enum, the input shape, or
Trial 4's scope. It exists because v1/v2 gave the judge no way to record
an observable expression shift that does not change the verdict (v2's
§2.1 could only push a case *into* `meaning_transformed` when hedging/
certainty/etc. shifted enough to cross that threshold — it had no output
for "this expression clearly shifted, but not enough, or not in a way
relevant to `verdict`, to change the verdict itself"). §2.2 and §3
(worked examples A-E) are the substantively new content; §1's task shape
gained the `dimensions` field; §4 gained one new "do not" bullet; §2,
§2.1, §5, §6, §7 are otherwise unchanged from v2 (carried forward by
reference rather than restated in full, except where restating was
necessary for the two-axis explanation).
