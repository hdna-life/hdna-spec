import type { T2Dimension } from './t2-dimensions';

/**
 * Per-evidence classifier output. Derived, rebuildable from the source text
 * at any time — never a canonical fact about the person.
 */
export interface TraitScoreRecord {
  sourceId: string;
  sourceType: string;
  /** 0..1 per dimension actually computed — only dimensions the classifier supports appear here. */
  scores: Partial<Record<T2Dimension, number>>;
  /** 0..1 per dimension, how much weight this observation should carry in aggregation. */
  confidence: Partial<Record<T2Dimension, number>>;
  extractorId: string;
  extractorVersion: string;
  computedAt: string;
  /**
   * Set once this record's scores have been folded into T2Profile. The
   * idempotency receipt for the at-least-once job queue — see
   * docs/decisions/0007 for the same pattern on EditMetrics.
   */
  profileAppliedAt?: string;
}
