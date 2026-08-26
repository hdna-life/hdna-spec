/**
 * T0 deterministic diff metrics computed from a single EditEvent. Derived —
 * fully rebuildable from the source EditEvent at any time.
 */
export interface EditMetrics {
  editEventId: string;
  /** Levenshtein distance between sourceText and finalText. */
  editDistance: number;
  /** finalText length / sourceText length, by character count. */
  compressionRatio: number;
  /** finalText sentence count - sourceText sentence count. */
  sentenceCountChange: number;
  /** Jaccard similarity of the two texts' word sets, 0..1. */
  lexicalOverlap: number;
  computedAt: string;
  /**
   * Set once these metrics have been folded into EditProfile. Doubles as the
   * idempotency receipt for the at-least-once job queue: a reclaimed/retried
   * job checks this before re-applying, instead of keeping a separate
   * growing list of processed event ids.
   */
  profileAppliedAt?: string;
}
