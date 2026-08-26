/**
 * Provider-agnostic T3 persona-interpretation contract, mirroring
 * EmbeddingProvider/TinyClassifier's "execution-context-agnostic interface"
 * shape (see spec/protocol/embedding-provider.ts, tiny-classifier.ts): no
 * fetch/API-key/HTTP concept here at all, so a concrete implementation
 * (e.g. an OpenRouter-backed one) can change entirely without touching
 * anything that consumes this interface.
 *
 * PatternCandidate is the data-minimization boundary: it deliberately
 * carries only the aggregate stats a Pattern exposes (dimension, context,
 * value, sampleCount) — never Pattern.supportingRecordIds, compilerId/
 * Version, or computedAt, and never raw canonical evidence (writing
 * samples, edit events). Nothing that could hint at raw evidence structure
 * crosses this boundary. See docs/decisions/0015.
 */
export interface PatternCandidate {
  dimension: string;
  context: string;
  value: number;
  sampleCount: number;
}

/**
 * A candidate TRAITS/BELIEFS claim as returned by a provider, before
 * validation. Deliberately not given the previous claim set as input (see
 * PersonaInterpreterService) — interpretation runs fresh from current
 * PatternCandidates only, to avoid a model's own prior output reinforcing
 * itself across successive runs.
 */
export interface TraitBeliefClaimDraft {
  claim: string;
  context: string;
  confidence: number;
  supportingPatternKeys: string[];
}

export interface PersonaInterpreterProvider {
  readonly providerId: string;
  readonly modelId: string;
  interpret(candidates: PatternCandidate[]): Promise<TraitBeliefClaimDraft[]>;
}
