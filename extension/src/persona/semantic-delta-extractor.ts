import type { SemanticDeltaCandidateDraft } from '@spec/protocol/semantic-delta-extractor';

/**
 * Validates a candidate draft against the epistemic discipline this
 * schema encodes: confidence must be a real probability, `observation`/
 * `context` must be non-empty, and a `contrastive_preference` draft must
 * actually supply both halves of its preference pair — a contrastive
 * claim with a missing half is incoherent. `behavioral_delta` drafts are
 * valid with `preferred`/`rejected` absent entirely: the extractor is
 * never forced to fabricate a contrastive relation that isn't there.
 *
 * Intentionally does NOT attempt automated trait-language detection (e.g.
 * flagging words like "personality"/"always") — that is a soft heuristic
 * prone to false positives/negatives and is explicitly the human
 * reviewer's job (docs/decisions/0016's grading protocol), not a code
 * gate. Keeping this function honest about what it can and can't enforce
 * avoids a false sense of automated safety.
 */
export function validateCandidateDraft(draft: SemanticDeltaCandidateDraft): boolean {
  if (draft.confidence < 0 || draft.confidence > 1) return false;
  if (draft.observation.trim().length === 0) return false;
  if (draft.context.trim().length === 0) return false;
  if (draft.kind === 'contrastive_preference') {
    if (!draft.preferred || draft.preferred.trim().length === 0) return false;
    if (!draft.rejected || draft.rejected.trim().length === 0) return false;
  }
  return true;
}
