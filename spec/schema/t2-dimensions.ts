/**
 * T2 derived behavioral dimensions, per the design doc's "tiny local
 * classifiers" section. These are estimates, never canonical facts — every
 * score must carry provenance (extractor id/version) and confidence, and
 * must be reproducible from the source evidence.
 */
export type T2Dimension =
  | 'formality'
  | 'directness'
  | 'warmth'
  | 'assertiveness'
  | 'politeness'
  | 'emotionalIntensity'
  | 'sarcasmLikelihood';

export type T2DimensionStatus = 'MVP_REQUIRED' | 'SPEC_RESERVED';

/**
 * Only formality and directness are implemented in this round — the
 * dimensions with the clearest deterministic heuristic signal. The other
 * five are typed (so the schema doesn't need to change when they're added)
 * but deliberately never populated; see docs/decisions/0010. Sarcasm in
 * particular needs conservative handling and is not attempted with a simple
 * heuristic.
 */
export const T2_DIMENSION_STATUS: Record<T2Dimension, T2DimensionStatus> = {
  formality: 'MVP_REQUIRED',
  directness: 'MVP_REQUIRED',
  warmth: 'SPEC_RESERVED',
  assertiveness: 'SPEC_RESERVED',
  politeness: 'SPEC_RESERVED',
  emotionalIntensity: 'SPEC_RESERVED',
  sarcasmLikelihood: 'SPEC_RESERVED',
};
