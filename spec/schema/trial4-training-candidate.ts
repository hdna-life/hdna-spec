import type { RevisionInterventionKind, SemanticChangeVerdict } from '../protocol/semantic-revision-judge';

/**
 * Trial 4's human-review decision on one DeepSeek-generated candidate
 * training example (docs/decisions/0017, Operator Decisions 1-2: DeepSeek
 * generates candidate/stimulus examples, it is never the ground-truth
 * authority — the human operator's accept/reject decision is). `'pending'`
 * is the only state a freshly-imported candidate can start in;
 * `'accepted'`/`'rejected'` are set exclusively by
 * `Trial4TrainingReviewPanel.svelte`'s operator actions, never inferred
 * automatically from any model output.
 */
export type Trial4TrainingCandidateDecision = 'pending' | 'accepted' | 'rejected';

/**
 * One DeepSeek-proposed (`AI draft + human final edit -> proposed
 * semantic/behavioral delta`) candidate training example, imported into
 * the extension for human review (docs/decisions/0017). Shape
 * deliberately mirrors `SemanticRevisionJudgeInput`/
 * `SemanticRevisionJudgmentDraft` (`@spec/protocol/semantic-revision-judge`)
 * — the same narrow evidence-plus-judgment unit Trial 3's judge providers
 * consume/produce — so an accepted candidate can be exported directly into
 * the exact `{prompt, completion}` shape `training/phase5a/` needs for
 * `mlx_lm.lora` SFT, with no schema translation step in between.
 *
 * Never a canonical persona record: this is disposable, reproducible-by-
 * regeneration experimental training material, not `SemanticDeltaCandidate`
 * persona evidence — classified `CACHE` in storage, not `DERIVED`/`CANONICAL`.
 */
export interface Trial4TrainingCandidate {
  id: string;
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  beforeContext: string;
  afterContext: string;
  /** DeepSeek's proposed judgment for this candidate — a training-signal proposal, not an accepted fact. */
  proposedVerdict: SemanticChangeVerdict;
  /** Null exactly when proposedVerdict is 'no_meaningful_change'/'uncertain', mirroring SemanticRevisionJudgmentDraft's convention. */
  proposedDescription: string | null;
  decision: Trial4TrainingCandidateDecision;
  /** ISO timestamp when this candidate was imported into the extension (not when DeepSeek generated it). */
  importedAt: string;
  /** ISO timestamp of the operator's accept/reject decision; absent while decision is 'pending'. */
  reviewedAt?: string;
}
