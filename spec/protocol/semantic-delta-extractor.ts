import type { SemanticDeltaCandidateKind } from '../schema/semantic-delta-candidate';

export interface SemanticDeltaExtractionInput {
  originalText: string;
  finalText: string;
  context: string;
}

/**
 * A candidate semantic delta as returned by a provider, before validation.
 * See SemanticDeltaCandidate for why `preferred`/`rejected` are optional.
 */
export interface SemanticDeltaCandidateDraft {
  kind: SemanticDeltaCandidateKind;
  observation: string;
  preferred?: string;
  rejected?: string;
  context: string;
  confidence: number;
}

/**
 * Provider-agnostic Phase 5A extraction contract, mirroring
 * EmbeddingProvider/TinyClassifier/PersonaInterpreterProvider's shape: no
 * fetch/API-key/HTTP concept here — see docs/decisions/0016.
 */
export interface SemanticDeltaExtractorProvider {
  readonly providerId: string;
  readonly modelId: string;
  /** May return an empty array — abstention is a valid, expected result, not a failure. */
  extract(input: SemanticDeltaExtractionInput): Promise<SemanticDeltaCandidateDraft[]>;
}
