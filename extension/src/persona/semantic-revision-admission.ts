import type { SemanticDeltaCandidateDraft } from '@spec/protocol/semantic-delta-extractor';
import type { SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';
import type { RevisionIntervention } from './revision-intervention';
import { validateJudgmentDraft } from './semantic-revision-judgment';

/**
 * Trial 3's deterministic admission gate (docs/decisions/0016's Trial 3
 * §8/§9). Turns one `(RevisionIntervention, SemanticRevisionJudgmentDraft)`
 * pair into a `SemanticDeltaCandidateDraft` or `null` (rejected/abstained)
 * — HDNA decides admission and `kind`, never the model.
 *
 * Rejects (`null`) when: the judgment fails structural validation
 * (`validateJudgmentDraft`: out-of-range confidence, unrecognized verdict,
 * missing description on a change-claiming verdict); the verdict is
 * `'no_meaningful_change'`; or the verdict is `'uncertain'`. Admits
 * otherwise.
 *
 * `kind` is derived deterministically from `intervention.kind`, never from
 * the model's verdict: a `'replaced'` intervention structurally *is* an
 * ORIGINAL -> FINAL "kept Y over X" relation — the intervention itself,
 * not the model's judgment, establishes the X-over-Y pair — so it maps to
 * `'contrastive_preference'` with `preferred`/`rejected` taken directly
 * from the intervention's own `finalText`/`originalText`. Every other
 * intervention kind (`'added'`/`'removed'`/`'reordered'`) has no such
 * structural two-sided pair and maps to `'behavioral_delta'`. This is not
 * "forcing every replacement into contrastive_preference" in the sense
 * Trial 3's brief warns against — cosmetic/no-op replacements never reach
 * this function at all, because `'no_meaningful_change'`/`'uncertain'`
 * verdicts are rejected above before `kind` is ever assigned.
 */
export function admitJudgment(
  intervention: RevisionIntervention,
  judgment: SemanticRevisionJudgmentDraft,
  context: string,
): SemanticDeltaCandidateDraft | null {
  if (!validateJudgmentDraft(judgment)) return null;
  if (judgment.verdict === 'no_meaningful_change') return null;
  if (judgment.verdict === 'uncertain') return null;

  // validateJudgmentDraft already guarantees description is a non-blank
  // string for every verdict reaching this point.
  const observation = (judgment.description as string).trim();

  if (intervention.kind === 'replaced') {
    return {
      kind: 'contrastive_preference',
      observation,
      preferred: intervention.finalText,
      rejected: intervention.originalText,
      context,
      confidence: judgment.confidence,
    };
  }

  return {
    kind: 'behavioral_delta',
    observation,
    context,
    confidence: judgment.confidence,
  };
}
