import type { SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';

const VALID_VERDICTS = new Set([
  'no_meaningful_change',
  'meaning_added',
  'meaning_removed',
  'meaning_transformed',
  'uncertain',
]);

const CHANGE_VERDICTS = new Set(['meaning_added', 'meaning_removed', 'meaning_transformed']);

/**
 * Trial 3's judgment-draft validation (docs/decisions/0016's Trial 3
 * §8 "Reject when"). Deliberately narrow and structural — it never
 * attempts psychological/keyword validation (same discipline as
 * `validateCandidateDraft` in `semantic-delta-extractor.ts`): out-of-range
 * confidence, an unrecognized verdict, or a change-claiming verdict
 * (`meaning_added`/`meaning_removed`/`meaning_transformed`) with a
 * missing/blank `description` are all rejected here; `no_meaningful_change`
 * and `uncertain` are valid with `description: null`.
 */
export function validateJudgmentDraft(draft: SemanticRevisionJudgmentDraft): boolean {
  if (typeof draft.confidence !== 'number' || draft.confidence < 0 || draft.confidence > 1) return false;
  if (!VALID_VERDICTS.has(draft.verdict)) return false;
  if (CHANGE_VERDICTS.has(draft.verdict)) {
    if (draft.description === null || draft.description.trim().length === 0) return false;
  }
  return true;
}
