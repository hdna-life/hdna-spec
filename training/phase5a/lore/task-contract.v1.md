# Phase 5A task/lore contract — v1

**Status:** versioned specialization contract for Trial 4
(`docs/decisions/0017`). This is the *only* document Trial 4's dataset
generation and training pipeline may treat as ground truth for what the
model should learn — it exists specifically so Trial 4 does not become "a
second, uncontrolled source of truth" about HDNA (Operator Decision 10).

**Traceability.** Every rule below is either a direct restatement of an
existing HDNA specification/decision, or a directly observed Phase 5A
failure class from Trials 0-3. Nothing here is invented fresh for
training purposes. Sources, by rule:

- The task itself (`AI draft + human final edit -> grounded semantic
  delta`) — `docs/decisions/0016`'s Phase 5A framing and
  `spec/protocol/semantic-revision-judge.ts`.
- The five-value verdict enum and its exact semantics — `spec/protocol/semantic-revision-judge.ts`.
- "Textual change != semantic change" — `docs/decisions/0016`'s Trial 2
  section (`revision-diff.ts`'s core distinction).
- "Do not attribute to the human meaning already present in the AI
  draft" — `docs/decisions/0016`'s Trial 0 "Important failure mode
  identified" section, and Trial 1's counterfactual-grounding rule.
- "A removal/replacement is observable; a motivation for it usually is
  not" — `docs/decisions/0016`'s Trial 2 "removal discipline" rule.
- "No persona/trait/psychology inference from one edit" —
  `docs/decisions/0016`'s observation-first boundary (Trial 0 onward) and
  the evidence hierarchy at the top of that decision
  (`CANONICAL EVIDENCE -> OBSERVATION -> REPEATED PATTERN -> TRAIT/BELIEF`).
- Language-generality — `docs/decisions/0016`'s Trial 2/3 language-general
  requirement.

**Versioning.** This is `v1`. Any future revision (`v2`, ...) must be a
new file, not an edit to this one, so a trained adapter's `manifest.json`
(see `../training/README.md`) can always name the exact contract version
it was trained against. Do not silently edit `v1` in place.

## 1. The task, restated exactly as Trial 3 specifies it

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
description:  one short sentence, or null (null iff verdict is
              'no_meaningful_change' or 'uncertain')
confidence:   a number between 0 and 1
```

This is the entire task. Nothing else is in scope for this contract.

## 2. What "meaningful" means here

A verdict other than `no_meaningful_change`/`uncertain` requires that the
localized intervention itself — not the final text's overall meaning, not
information already present in the original — introduces, removes, or
transforms an observable semantic or pragmatic property. Illustrative,
non-exhaustive categories (do not treat this as a closed taxonomy, and do
not add categories not grounded in the sources above): stance, modality,
commitment, certainty, conditionality, intensity, framing, specificity,
directness, formality, interpersonal stance.

**The counterfactual check (from Trial 1, still the operative test):**
would this exact observation still be true having only ever seen the
ORIGINAL span, never the FINAL span? If yes, the correct verdict is
`no_meaningful_change` — the meaning was already present, not introduced
by this edit.

## 3. What must NOT be produced (grounded directly in observed failure classes)

- **Do not attribute pre-existing meaning to the edit.** (Trial 0's
  primary failure mode: "the extractor may emit '...' as a delta, which
  describes the final text accurately but was already present pre-edit.")
- **Do not infer a motivation, reason, or psychological explanation for a
  removal or replacement** unless the FINAL text itself states that
  reason directly. (Trial 2's removal-discipline rule, targeting Trial
  1's "over-interpreted removal" failure class.) Example of what NOT to
  produce: labeling a removal as "minimizing the impact" or "external
  justification" when the text itself never says so (both real Trial 2
  `UNSUPPORTED` cases).
- **Do not infer stable personality, motivation, psychology, demographics,
  or identity** from one intervention. This is a hard boundary, not a
  style preference — HDNA's entire evidence hierarchy depends on it
  (persona-level claims require *repeated* evidence and a later
  aggregation stage this task does not perform).
- **Do not use textual-diff magnitude as evidence of semantic-change
  magnitude**, in either direction. A one-word removal can be a large
  pragmatic shift (Trial 2's real example: removing "I think"-equivalent
  hedging read as a shift toward directness); a large rewrite can preserve
  meaning entirely.
- **Do not rely on language-specific wording, suffixes, or grammar.** Any
  training example that only "works" because of a particular language's
  surface form is out of contract — reason about the underlying meaning
  shift, however it happens to be expressed.
- **Do not invent a comparison that contradicts the FINAL text.** (Trial
  2's second `UNSUPPORTED` case: a candidate claimed the human didn't
  acknowledge a prior issue, when the FINAL text explicitly did — an
  internal-contradiction error, not a grounding error, but equally
  disqualifying.)

## 4. Kind-specific notes

- `'replaced'`: the two spans (original -> final) are a structural
  candidate for a "kept Y over X" relation, but that structural fact
  alone is never sufficient — a cosmetic correction (e.g. a typo fix) is
  `'replaced'` too and must be judged `no_meaningful_change`. (This
  is exactly the failure class Trial 2 surfaced: "the deterministic layer
  correctly localized a replacement... the semantic extractor interpreted
  this as [a claim] graded UNSUPPORTED — the textual change is real, but
  the claimed semantic narrowing is not sufficiently supported by it.")
- `'added'`/`'removed'`: judge only the added/removed content itself, in
  its context — never invent what "would have" changed about content
  that didn't move.
- `'reordered'`: a transposition of two adjacent spans; most reorderings
  are `no_meaningful_change` (word order rarely changes meaning), but a
  reordering that changes emphasis or logical sequence is a legitimate
  `meaning_transformed` candidate — judge the actual case, do not assume
  either default.

## 5. Abstention is correct, not a failure

`no_meaningful_change` and `uncertain` are valid, expected, and often
*correct* answers. A dataset — and a model — that never abstains is
miscalibrated, not thorough. Do not generate or accept training examples
that pressure the model toward always finding a "meaningful" verdict.

## 6. What this contract explicitly does not cover (out of scope for Trial 4)

Per `docs/decisions/0017`'s scope-control decisions: persona/trait
aggregation, repeated-evidence reasoning, cross-intervention comparison,
retrieval, and any notion of "is this useful for persona reconstruction"
are all out of scope for this contract and for Trial 4's training data.
Generating or accepting a training example that reasons about anything
beyond one localized intervention is out of contract.
