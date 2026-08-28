# Phase 5A task/lore contract — v2

**Status:** versioned specialization contract for Trial 4
(`docs/decisions/0017`). This is the *only* document Trial 4's dataset
generation and training pipeline may treat as ground truth for what the
model should learn — it exists specifically so Trial 4 does not become "a
second, uncontrolled source of truth" about HDNA (Operator Decision 10).

**Supersedes `task-contract.v1.md`.** v1 is preserved unchanged, not
deleted or edited in place, per this document's own versioning rule
below. v2's only substantive change from v1 is the new §2.1 below — see
"Changelog from v1" at the end of this file for exactly what changed and
why.

**Traceability.** Every rule below is either a direct restatement of an
existing HDNA specification/decision, a directly observed Phase 5A
failure class from Trials 0-3, or (for §2.1 only, new in v2) an explicit
operator decision drawn from failure-driven review of Trial 4's own
generated data — see "Changelog from v1." Nothing here is invented fresh
for training purposes beyond what one of those three sources grounds.
Sources, by rule:

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
- **New in v2:** "A changed factual topic is not required for a
  meaningful change" (§2.1) — an explicit operator decision, made after
  reviewing the first 30 human-reviewed Trial 4 candidates generated
  under v1. Not drawn from Trial 0-3 (which never isolated this failure
  class explicitly), and not previously documented anywhere else in this
  repository before this file.

**Versioning.** This is `v2`. Any future revision (`v3`, ...) must be a
new file, not an edit to this one, so a trained adapter's `manifest.json`
(see `../README.md`) can always name the exact contract version it was
trained against. Do not silently edit `v2` in place.

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

### 2.1. A changed factual topic is not required for a meaningful change (NEW in v2)

Changes to **hedging, certainty, intensity, commitment, directive
strength, qualification, rationale, framing, or scope** may constitute
meaningful behavioral/semantic changes even when the core factual
proposition remains unchanged. **Do not classify such changes as
`no_meaningful_change` merely because the underlying factual topic
remains the same.**

This is the single most important correction v2 makes to how the
counterfactual check in §2 is applied. The counterfactual check asks
whether the *observation* would still be true having seen only the
ORIGINAL — it does not ask whether the *topic* changed. A generator or
judge that silently substitutes "did the topic change?" for "did the
counterfactual check pass?" will systematically misclassify genuine
pragmatic/behavioral shifts as `no_meaningful_change` whenever the two
spans are "about" the same thing on the surface. They frequently are not
the same thing at all once hedging/certainty/commitment/scope is
accounted for. Two worked examples:

- `"This might help with the issue."` -> `"This will fix the issue."`
  Same factual topic (the issue, the proposed fix) — but certainty shifted
  from hedged/possible to asserted/certain. **`meaning_transformed`**, not
  `no_meaningful_change`.
- `"You should consider running the tests before merging."` ->
  `"Run the tests before merging."`
  Same factual topic (running tests before merging) — but directive
  strength shifted from a soft suggestion to an imperative. **`meaning_transformed`**,
  not `no_meaningful_change`.

Conversely, this rule does **not** mean every rewording of the same topic
is meaningful — a change that alters none of hedging/certainty/intensity/
commitment/directive-strength/qualification/rationale/framing/scope, and
genuinely only rephrases the same claim with the same force, is still
correctly `no_meaningful_change`. §2's counterfactual check remains the
actual test; §2.1 exists because "same topic" was being used as a proxy
for that test, and the proxy is wrong.

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
- **Do not use unchanged factual topic as evidence of no semantic
  change** (new in v2, §2.1) — the same failure shape as the previous
  bullet, one level more specific: "same topic" is not "same meaning."
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
  Per §2.1, a `'replaced'` pair that keeps the same factual topic is
  **not** automatically cosmetic either — check hedging/certainty/
  intensity/commitment/directive-strength/qualification/rationale/
  framing/scope before defaulting to `no_meaningful_change`.
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
**§2.1 corrects a specific over-application of this rule** (topic-sameness
used as a shortcut for "no meaningful change") — it does not weaken this
rule generally; a genuinely meaning-preserving rewording, even with
different hedging-neutral wording, is still correctly `no_meaningful_change`.

## 6. What this contract explicitly does not cover (out of scope for Trial 4)

Per `docs/decisions/0017`'s scope-control decisions: persona/trait
aggregation, repeated-evidence reasoning, cross-intervention comparison,
retrieval, and any notion of "is this useful for persona reconstruction"
are all out of scope for this contract and for Trial 4's training data.
Generating or accepting a training example that reasons about anything
beyond one localized intervention is out of contract.

## Changelog from v1

**v2 is a failure-driven refinement, not an architecture or scope
change** — it corrects one classification rule after the operator's
first human-review pass over 30 candidates generated under v1 surfaced a
systematic pattern: candidates whose two spans discussed the same
underlying factual topic were being proposed/classified as
`no_meaningful_change` even when hedging, certainty, intensity,
commitment, directive strength, qualification, rationale, framing, or
scope had clearly shifted. §2.1 is the only new content; §1, §3 (aside
from one added bullet restating the same correction), §4 (aside from one
added sentence under `'replaced'`), §5 (aside from one added sentence),
and §6 are otherwise unchanged from v1. No new verdict value, no new
field, no change to the task's input/output shape, no expansion of
Trial 4's scope beyond what `docs/decisions/0017` already authorizes.
