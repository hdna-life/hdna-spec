import type { Pattern } from '@spec/schema/pattern';
import type { PersonaInterpreterPolicy } from '@spec/schema/persona-interpreter-policy';
import type { PatternCandidate, TraitBeliefClaimDraft } from '@spec/protocol/persona-interpreter';

/** The same "dimension:context" composite key PatternStore uses internally. */
export function patternKey(pattern: Pick<Pattern, 'dimension' | 'context'>): string {
  return `${pattern.dimension}:${pattern.context}`;
}

/** Data-minimization boundary: drops everything except the aggregate stats a provider needs. */
export function toPatternCandidate(pattern: Pattern): PatternCandidate {
  return {
    dimension: pattern.dimension,
    context: pattern.context,
    value: pattern.value,
    sampleCount: pattern.sampleCount,
  };
}

/** The deterministic evidence-threshold gate — no network call is made unless this passes. */
export function isEligibleForInterpretation(patterns: Pattern[], policy: PersonaInterpreterPolicy): boolean {
  return patterns.length >= policy.minPatternCount;
}

/**
 * Conservative-inference guardrail: rejects a draft whose confidence is out
 * of range, whose claim text is empty, or whose supporting keys reference a
 * pattern the provider was never given (a hallucinated evidence link).
 * Invalid drafts are dropped, not fixed up — the same "abstain rather than
 * fabricate" discipline as HeuristicTinyClassifier.
 */
export function validateClaimDraft(draft: TraitBeliefClaimDraft, candidateKeys: Set<string>): boolean {
  if (draft.confidence < 0 || draft.confidence > 1) return false;
  if (draft.claim.trim().length === 0) return false;
  if (draft.supportingPatternKeys.length === 0) return false;
  return draft.supportingPatternKeys.every((key) => candidateKeys.has(key));
}
