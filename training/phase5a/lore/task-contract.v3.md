# HDNA localized edit-judgment contract — v3

**Status: canonical, active.** This is the single self-contained source of
truth for the localized edit-judgment policy used by Phase 5A Trial 4 /
Test 1 (CLOSED — SUCCESS, see `training/phase5a/benchmark/test1-final-result.md`)
and carried forward as-is into Test 2's synthetic-distillation training
and evaluation. It exists specifically so this training/evaluation policy
never becomes "a second, uncontrolled source of truth" about HDNA
(`docs/decisions/0017`, Operator Decision 10) — every rule below traces to
an existing HDNA specification/decision, a directly observed failure
class from Trial 0-3/Test 1, or an explicit operator decision, never
invented fresh for training purposes.

This document does not require any prior version to understand. `v1` and
`v2` are superseded and are **not** kept as active files in this
directory — their content and the reasoning behind each revision are
preserved in Git history only (`git log -- training/phase5a/lore/`), not
as competing active contracts.

**Machine-readable counterpart:** `training/phase5a/lore/policy-spec.v1.json`
encodes the verdict list, the dimension→direction mapping, and the core
rules below for tooling (Test 2 generator/verifier/runtime). The two files
must agree exactly; if they ever diverge, this file is the human-authored
source and the JSON must be corrected to match it.

**Versioning.** This is `v3`. Any future revision (`v4`, ...) must be a
new file, not an edit to this one.

## 1. The task

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
dimensions:   zero or more { dimension, direction } pairs — see §3
description:  one short sentence, or null (null iff verdict is
              'no_meaningful_change' or 'uncertain')
confidence:   a number between 0 and 1
```

**`verdict` and `dimensions` are the core learning target** — the two
orthogonal judgments this contract exists to teach (§2, §3).
`description`/`confidence` are auxiliary fields, preserved here only
because the current runtime wire protocol
(`extension/src/persona/semantic-revision-judge-wire.ts`) still requires
all four keys on every response; they are not themselves the policy this
document defines, and a future runtime contract could drop or change them
without changing §2/§3's substance. This is the entire task — nothing
else is in scope for this contract.

## 2. The semantic/practical verdict axis

A verdict other than `no_meaningful_change`/`uncertain` requires that the
localized intervention itself — not the final text's overall meaning, not
information already present in the original — introduces, removes, or
transforms an observable semantic or pragmatic property. Illustrative,
non-exhaustive categories (not a closed taxonomy; do not add categories
not grounded in this contract): stance, modality, commitment, certainty,
conditionality, intensity, framing, specificity, directness, formality,
interpersonal stance.

**The counterfactual check:** would this exact observation still be true
having only ever seen the ORIGINAL span, never the FINAL span? If yes,
the correct verdict is `no_meaningful_change` — the meaning was already
present, not introduced by this edit.

**A changed factual topic is not required for a meaningful change.**
Changes to hedging, certainty, intensity, commitment, directive strength,
qualification, rationale, framing, or scope may constitute meaningful
semantic/pragmatic changes even when the core factual proposition remains
unchanged. **Do not classify such changes as `no_meaningful_change` merely
because the underlying factual topic remains the same** — the
counterfactual check asks whether the *observation* would still be true
having seen only the ORIGINAL, not whether the *topic* changed. Two
examples:

- `"This might help with the issue."` -> `"This will fix the issue."` —
  same factual topic, but certainty shifted from hedged/possible to
  asserted/certain. **`meaning_transformed`**, not `no_meaningful_change`.
- `"You should consider running the tests before merging."` ->
  `"Run the tests before merging."` — same factual topic, but directive
  strength shifted from a soft suggestion to an imperative.
  **`meaning_transformed`**, not `no_meaningful_change`.

Conversely, this does **not** mean every rewording of the same topic is
meaningful — a change that alters none of hedging/certainty/intensity/
commitment/directive-strength/qualification/rationale/framing/scope, and
genuinely only rephrases the same claim with the same force, is still
correctly `no_meaningful_change`. The counterfactual check remains the
actual test; "same topic" is not a substitute for it.

## 3. The observable-behavior dimension axis

Every localized intervention has **two related but distinct properties** a
judge must reason about separately:

1. **SEMANTIC/PRACTICAL RELATION** — the `verdict` field (§2). Did the
   intervention add, remove, transform, or preserve meaning as tested by
   the counterfactual check?
2. **OBSERVABLE BEHAVIORAL/EXPRESSION CHANGE** — the `dimensions` field.
   Did the FINAL text's *directly observable expression* — tone, affect,
   certainty, directness, politeness, formality, commitment, scope, etc.
   — change relative to the ORIGINAL, independent of whether the
   proposition itself changed?

**Do not collapse these into one taxonomy.** An edit can change one axis
without the other, both together, or neither — see worked examples A-E in
§4.

**Never infer a hidden emotional or psychological state.** Dimensions
describe the text's *observable expressed* properties (hence
`expressed_affect_*`, never `emotion`/`mood`/any term implying access to
someone's actual internal state). "The writer used more intense language"
is a valid observation; "the writer felt more strongly" is not — it
claims access to an internal state the text does not license.

### 3.1. The dimension taxonomy (closed, versioned)

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

### 3.2. The canonical dimension→direction mapping (normative)

Exactly these 9 direction values exist: `increased`, `decreased`,
`more_positive`, `more_negative`, `added`, `removed`, `narrowed`,
`expanded`, `changed`. **The mapping below is normative, not
illustrative** — a `{dimension, direction}` pair outside its dimension's
listed directions is invalid and must be rejected, the same way an
unrecognized dimension or direction value is rejected:

| Dimension | Allowed directions |
|---|---|
| `expressed_affect_valence` | `more_positive`, `more_negative` |
| `expressed_affect_intensity` | `increased`, `decreased` |
| `directness` | `increased`, `decreased` |
| `politeness` | `increased`, `decreased` |
| `formality` | `increased`, `decreased` |
| `certainty` | `increased`, `decreased` |
| `evidentiality` | `changed` |
| `commitment` | `increased`, `decreased` |
| `directive_force` | `increased`, `decreased` |
| `conditionality` | `added`, `removed` |
| `scope` | `narrowed`, `expanded` |
| `specificity` | `increased`, `decreased` |
| `rationale` | `added`, `removed` |
| `factual_content` | `changed` |
| `action_or_decision` | `changed` |

### 3.3. Cardinality rules

- `no_meaningful_change` MAY have a non-empty `dimensions` array — this is
  the primary capability this axis adds (see worked examples A/B in §4).
- `uncertain` always has `dimensions: []`. Do not attempt dimension
  judgments when the verdict itself is uncertain.
- `meaning_added`/`meaning_removed`/`meaning_transformed` should normally
  carry at least one dimension (a meaning change is very often
  accompanied by an observable expression shift), but this is guidance,
  not a hard requirement — a rare case can legitimately have `[]`.
- No duplicate dimensions within one judgment (each `dimension` value
  appears at most once in the array).
- Zero, one, or several dimensions are all valid.

### 3.4. Core rules (normative — apply to every judgment)

- The semantic verdict (§2) and behavioral dimensions (§3) are
  **orthogonal** — never collapse them into one taxonomy, never let one
  axis's value determine the other's.
- Judge **directly observable textual behavior only** — the wording
  actually present, nothing inferred beyond it.
- **Never infer hidden emotion, motivation, psychology, identity, or
  personality** from one intervention. This is a hard boundary, not a
  style preference — HDNA's entire evidence hierarchy depends on it
  (persona-level claims require *repeated* evidence and a later
  aggregation stage this task does not perform).
- **Expressed affect describes the text, not the human's internal
  state.** `expressed_affect_valence`/`expressed_affect_intensity` are
  claims about the wording, never about how the writer or subject
  actually feels.
- **No duplicate dimensions** within one judgment (§3.3).
- **`uncertain` => `dimensions: []`** (§3.3).
- **Longer text does not automatically mean `specificity: increased`.**
  Length and specificity are different properties — judge whether the
  FINAL text actually names more particular/concrete detail than the
  ORIGINAL, not whether it is longer.
- **Softer wording does not automatically imply a `directive_force`
  change.** Politeness/formality and directive force are different
  dimensions — a softened imperative can keep the exact same directive
  force ("Please run the tests before merging" is still as directive as
  "Run the tests before merging"); judge whether the actual
  suggestion-vs-command strength changed, not just the surface tone.
- **Social persuasiveness/manipulation is not `directive_force`.**
  `directive_force` measures how strongly the text instructs an action —
  not how rhetorically persuasive, flattering, or manipulative it is.
- **Temporal ordering alone is not `conditionality`.** "First do X, then
  Y" is a sequence, not a condition — `conditionality` requires an actual
  if/then dependency between a condition and an outcome.
- **`action_or_decision` changes only when an actual action or decision
  changes** — not merely because the sentence mentions an action/decision
  topic, and not as a catch-all for any edit that doesn't fit elsewhere.
- **Use conservative dimensions; do not force labels.** An edit with no
  genuine observable expression shift gets `dimensions: []` (§3.3, §4
  worked example E) — never pad the array to look more thorough. When in
  doubt between two adjacent dimensions, prefer the narrower, more
  clearly-grounded one, or omit it.

## 4. Worked examples (A-E)

These are the canonical calibration examples — both any generator and any
human reviewer should agree with these exact verdict/dimension
assignments.

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
Directive strength shifted from soft suggestion to imperative.

**E.** `"The report is due Friday."` -> `"The report is due  Friday."`
(a stray double-space correction — a purely cosmetic edit)
`verdict: no_meaningful_change`, `dimensions: []`
Neither axis changed. Not every edit carries an expression shift — do
not force a dimension onto a genuinely cosmetic change merely because the
text differs. This is the counterpart to A/B/C/D: `dimensions: []` is
just as valid and expected an answer as a non-empty array.

## 5. What must NOT be produced

- **Do not attribute pre-existing meaning to the edit.** A judgment must
  never describe the FINAL text's meaning if that meaning was already
  true of the ORIGINAL span — that is what the counterfactual check (§2)
  exists to catch.
- **Do not infer a motivation, reason, or psychological explanation for a
  removal or replacement** unless the FINAL text itself states that
  reason directly. Example of what NOT to produce: labeling a removal as
  "minimizing the impact" or "external justification" when the text
  itself never says so.
- **Do not infer stable personality, motivation, psychology,
  demographics, or identity** from one intervention (§3.4).
- **Do not infer a hidden emotional/psychological state as a dimension
  judgment** — `expressed_affect_valence`/`expressed_affect_intensity`
  describe the text's expressed affect, never the subject's or writer's
  actual internal emotional state (§3.4, worked example B).
- **Do not use textual-diff magnitude as evidence of semantic-change
  magnitude**, in either direction. A one-word removal can be a large
  pragmatic shift; a large rewrite can preserve meaning entirely.
- **Do not use unchanged factual topic as evidence of no semantic
  change** — "same topic" is not "same meaning" (§2).
- **Do not rely on language-specific wording, suffixes, or grammar.** Any
  judgment that only "works" because of a particular language's surface
  form is out of contract — reason about the underlying meaning/behavior
  shift itself, however it happens to be expressed.
- **Do not invent a comparison that contradicts the FINAL text.**

## 6. Kind-specific notes

- `'replaced'`: the two spans (original -> final) are a structural
  candidate for a "kept Y over X" relation, but that structural fact
  alone is never sufficient — a cosmetic correction (e.g. a typo fix) is
  `'replaced'` too and must be judged `no_meaningful_change`. A
  `'replaced'` pair that keeps the same factual topic is **not**
  automatically cosmetic either — check hedging/certainty/intensity/
  commitment/directive-strength/qualification/rationale/framing/scope
  before defaulting to `no_meaningful_change`.
- `'added'`/`'removed'`: judge only the added/removed content itself, in
  its context — never invent what "would have" changed about content
  that didn't move.
- `'reordered'`: a transposition of two adjacent spans; most reorderings
  are `no_meaningful_change` (word order rarely changes meaning), but a
  reordering that changes emphasis or logical sequence is a legitimate
  `meaning_transformed` candidate — judge the actual case, do not assume
  either default.

The dimension axis (§3) is judged the same way regardless of `kind`.

## 7. Abstention is correct, not a failure

`no_meaningful_change` and `uncertain` are valid, expected, and often
*correct* answers. A dataset — and a model — that never abstains is
miscalibrated, not thorough. An empty `dimensions: []` array is its own
form of correct abstention on the expression axis, exactly as
`no_meaningful_change`/`uncertain` are correct abstentions on the verdict
axis (§4, worked example E). Do not generate or accept training examples
that pressure the model toward always finding a meaningful verdict or a
dimension shift.

## 8. What this contract explicitly does not cover

Persona/trait aggregation, repeated-evidence reasoning,
cross-intervention comparison, retrieval, and any notion of "is this
useful for persona reconstruction" are all out of scope for this
contract. The dimension axis describes **one intervention's own
observable expression**, never a pattern across interventions — a single
`dimensions` judgment is not itself evidence of a persona trait. A
judgment that reasons about anything beyond one localized intervention is
out of contract.
