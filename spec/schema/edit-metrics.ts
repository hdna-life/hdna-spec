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
}
