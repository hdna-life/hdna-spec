import type { SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';
import { isValidDimensionsArray } from './behavior-dimension';

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
 *
 * **Test 1 addendum (docs/decisions/0017):** also validates `dimensions` —
 * must be a well-formed, duplicate-free `BehaviorDimensionChange[]`
 * (`isValidDimensionsArray`), and `'uncertain'` must carry `dimensions: []`
 * (kept simple for this first Test 1 pass — no uncertain-with-dimensions
 * case yet, per the operator's explicit instruction). Every other verdict
 * — including `'no_meaningful_change'` — may carry zero, one, or several
 * dimensions; this validator does not require or forbid a non-empty
 * dimensions array for any verdict other than `'uncertain'`.
 */
export function validateJudgmentDraft(draft: SemanticRevisionJudgmentDraft): boolean {
  if (typeof draft.confidence !== 'number' || draft.confidence < 0 || draft.confidence > 1) return false;
  if (!VALID_VERDICTS.has(draft.verdict)) return false;
  if (CHANGE_VERDICTS.has(draft.verdict)) {
    if (draft.description === null || draft.description.trim().length === 0) return false;
  }
  if (!isValidDimensionsArray(draft.dimensions)) return false;
  if (draft.verdict === 'uncertain' && draft.dimensions.length > 0) return false;
  return true;
}
