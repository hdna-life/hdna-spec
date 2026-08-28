import type { BehaviorDimensionChange, RevisionInterventionKind, SemanticChangeVerdict } from '../protocol/semantic-revision-judge';

/**
 * Which language this candidate's text is in — metadata for dataset
 * balancing/reporting ONLY (docs/decisions/0017's Test 1 addendum: current
 * target is 120 Turkish / 80 English). MUST NEVER be fed to the judge
 * prompt (`buildNarrowJudgePrompt` never reads it) — the whole point of
 * Trial 3/4's language-generality requirement is that the judge reasons
 * about meaning/behavior shift, not language identity. Optional so
 * candidates imported before this field existed remain valid.
 */
export type Trial4CandidateLanguage = 'tr' | 'en';

/**
 * Structured reason codes for excluding a candidate from training
 * (docs/decisions/0017's "structured decisions" addendum). A candidate
 * may carry more than one — `Trial4TrainingCandidate.exclusionReasons` is
 * an array, not a single value. This is a closed, deliberately small set;
 * `'other'` plus `operatorNoteTr` covers anything not named here. Turkish
 * display labels live in `extension/src/persona/trial4-review-state.ts`'s
 * `EXCLUSION_REASON_LABELS_TR` — not duplicated here, since this file is
 * shared spec, not UI.
 */
export type Trial4ExclusionReason =
  | 'synthetic_or_unrealistic'
  | 'insufficient_context'
  | 'malformed_original_or_final'
  | 'wrong_intervention_boundary'
  | 'too_easy_low_training_value'
  | 'duplicate_or_near_duplicate'
  | 'misleading_turkish_explanation'
  | 'description_not_supported_by_edit'
  | 'does_not_fit_category'
  | 'other';

/**
 * One DeepSeek-proposed (`AI draft + human final edit -> proposed
 * semantic/behavioral delta`) candidate training example, imported into
 * the extension for human review (docs/decisions/0017). Shape
 * deliberately mirrors `SemanticRevisionJudgeInput`/
 * `SemanticRevisionJudgmentDraft` (`@spec/protocol/semantic-revision-judge`)
 * for the fields DeepSeek proposes, so an included candidate can still be
 * exported directly into the `{prompt, completion}` shape `training/phase5a/`
 * needs for `mlx_lm.lora` SFT, with no schema translation step in between.
 *
 * Never a canonical persona record: this is disposable, reproducible-by-
 * regeneration experimental training material, not `SemanticDeltaCandidate`
 * persona evidence — classified `CACHE` in storage, not `DERIVED`/`CANONICAL`.
 *
 * **Three independent concepts, never collapsed into one Accept/Reject
 * state** (docs/decisions/0017's structured-decisions addendum):
 *
 * 1. **Human semantic verdict + observable-behavior dimensions**
 *    (`humanVerdict`/`humanDimensions`) — what is the correct label, on
 *    BOTH the semantic/practical axis (`humanVerdict`) and the orthogonal
 *    observable-behavior axis (`humanDimensions`)? Together these are the
 *    authoritative training ground truth, replacing
 *    `proposedVerdict`/`proposedDimensions` for that purpose — but
 *    `proposedVerdict`/`proposedDimensions`/`proposedDescription` are
 *    NEVER overwritten; all proposed values are always preserved so
 *    human/model disagreement remains inspectable on both axes.
 * 2. **Training eligibility** (`includeInTraining`) — should this example
 *    train the model? Independent of whether a verdict was ever assigned:
 *    an unrealistic candidate can be excluded (`includeInTraining: false`,
 *    `humanVerdict: null`, populated `exclusionReasons`) without the
 *    operator ever having to pick a semantic label for it.
 * 3. **Lore evidence** (`loreImportant`/`loreNoteTr`) — does this example
 *    reveal something important about how the task itself should be
 *    defined? Fully independent of 1 and 2: a candidate can be excluded
 *    from training AND marked lore-important, or included AND marked
 *    lore-important, in any combination.
 */
export interface Trial4TrainingCandidate {
  id: string;
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  beforeContext: string;
  afterContext: string;
  /** Dataset balancing/reporting metadata only — never fed to the judge prompt. See `Trial4CandidateLanguage`. Optional for candidates imported before this field existed. */
  language?: Trial4CandidateLanguage;
  /** DeepSeek's original proposed judgment — a training-signal proposal, never overwritten by the human's decision. */
  proposedVerdict: SemanticChangeVerdict;
  /** DeepSeek's original proposed description — never overwritten. Null exactly when proposedVerdict is 'no_meaningful_change'/'uncertain'. */
  proposedDescription: string | null;
  /**
   * DeepSeek's original proposed observable-behavior dimensions — never
   * overwritten by the human's selection, exactly like `proposedVerdict`.
   * The review UI may display these as suggestions, but they remain
   * visually/structurally separate from `humanDimensions` and are NEVER
   * auto-copied into it (that would reintroduce teacher bias — see this
   * interface's top-level docstring). Optional so candidates imported
   * before this field existed default to `[]`, never `undefined`, at the
   * point of import (`extension/src/persona/trial4-training-candidate-import.ts`).
   */
  proposedDimensions: BehaviorDimensionChange[];
  /**
   * Turkish-language review assistance ONLY — DeepSeek's own natural-
   * language explanation of the original->final change and its proposed
   * verdict, generated in the same request that produces the rest of this
   * candidate (`training/phase5a/dataset/generate_candidates.py`), not a
   * second translation call. Distinct from `operatorNoteTr` (the human's
   * own note) and `loreNoteTr` (the human's lore explanation) — this one
   * is the model's, not the operator's.
   *
   * NOT canonical, NOT part of the task/lore contract, and MUST NEVER
   * enter the training dataset: `training/phase5a/dataset/split_dataset.py`
   * deliberately never reads it. Optional so candidates imported before
   * this field existed remain valid.
   */
  reviewNoteTr?: string;

  /**
   * The operator's authoritative semantic verdict — training ground
   * truth. Null until the operator reviews this candidate as a *valid*
   * example; also null (deliberately, never populated) when the
   * candidate is excluded via `includeInTraining: false` — an excluded
   * candidate does not require a verdict at all.
   */
  humanVerdict: SemanticChangeVerdict | null;
  /**
   * The operator's authoritative observable-behavior dimensions —
   * training ground truth alongside `humanVerdict`. Independent of which
   * top-level review choice was made: the "Anlam aynı, ifade / ton
   * değişti" UI option requires at least one entry here (enforced by the
   * review UI, not this schema); "Anlamlı değişiklik yok" explicitly saves
   * `[]`; `meaning_added`/`meaning_removed`/`meaning_transformed` may also
   * carry dimensions. Defaults to `[]` for an unreviewed/excluded
   * candidate — never `undefined`.
   */
  humanDimensions: BehaviorDimensionChange[];
  /**
   * True = valid example; `humanVerdict` is ground truth and this
   * candidate is eligible for the training-dataset export. False = either
   * not yet reviewed (see `reviewedAt`) or explicitly excluded — check
   * `exclusionReasons`/`operatorNoteTr` to tell the two apart. Defaults to
   * `false` for a freshly-imported, unreviewed candidate.
   */
  includeInTraining: boolean;
  /**
   * Populated only when the operator explicitly excludes this candidate
   * (`includeInTraining: false` AND `reviewedAt` set). Multiple reasons
   * are allowed. Empty for an included or not-yet-reviewed candidate.
   */
  exclusionReasons: Trial4ExclusionReason[];
  /**
   * The operator's own free-text Turkish note — "Neden kötü? / Not."
   * Required context for an exclusion decision in practice, but the field
   * itself is always a plain string (never null); empty string means no
   * note was written.
   */
  operatorNoteTr: string;
  /**
   * Independent of `includeInTraining` — see this interface's top-level
   * docstring. A candidate marked lore-important is exported into
   * `lore-evidence.json` regardless of its training-eligibility status.
   */
  loreImportant: boolean;
  /**
   * "Bu örnek bize ne öğretiyor?" — the operator's own explanation, in
   * their own words, of what semantic rule/boundary this example
   * illustrates. Populated when `loreImportant` is true; null otherwise.
   * Deliberately free-form, not required to use formal terminology — the
   * goal is capturing the human's reasoning, not producing a polished
   * spec update. Later analysis may turn these into an explicit
   * task-contract revision; this field alone never modifies the contract.
   */
  loreNoteTr: string | null;

  /** ISO timestamp when this candidate was imported into the extension (not when DeepSeek generated it). */
  importedAt: string;
  /** ISO timestamp of the operator's most recent review decision; absent means this candidate has never been reviewed (pending). */
  reviewedAt?: string;
}
