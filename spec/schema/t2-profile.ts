/**
 * T1-style running aggregate over every TraitScoreRecord observed so far,
 * per dimension. Confidence-weighted: a low-confidence observation moves the
 * mean less than a high-confidence one. Updated incrementally (existing
 * aggregate + one new observation), never by rescanning full history.
 */
export interface T2DimensionAggregate {
  weightedMeanScore: number;
  /** Sum of confidence weights folded in so far — the denominator for the incremental weighted mean. */
  totalConfidenceWeight: number;
  sampleCount: number;
}

export interface T2Profile {
  formality?: T2DimensionAggregate;
  directness?: T2DimensionAggregate;
  updatedAt: string;
}
