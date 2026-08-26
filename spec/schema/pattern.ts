/**
 * A contextual, probabilistic behavioral tendency compiled from derived
 * evidence (EditMetrics, TraitScoreRecord) — the design doc's PATTERNS
 * canonical layer, one step above raw T0/T1/T2 signals and one step below
 * TRAITS/BELIEFS (not implemented — see docs/decisions/0011). Patterns are
 * scoped by context ("writing.public_social" vs "writing.private_message"
 * style buckets) since the same dimension can differ meaningfully across
 * contexts, per the doc's risk_tolerance example.
 *
 * Never a canonical fact — fully rebuildable from the underlying evidence,
 * and only compiled once its supporting evidence crosses an explicit
 * threshold (see PatternCompilerPolicy).
 */
export interface Pattern {
  /** e.g. "formality", "directness", "compressionRatio", "lexicalOverlap". */
  dimension: string;
  /** Context bucket (from evidence's context.surface); "unscoped" when no context was recorded. */
  context: string;
  /** Confidence-weighted mean value for this dimension within this context. */
  value: number;
  /** Sum of confidence weights backing `value`. */
  confidenceWeight: number;
  sampleCount: number;
  /** Composite ids ("sourceType:sourceId") of every contributing derived-evidence record — the supporting-evidence link. */
  supportingRecordIds: string[];
  compilerId: string;
  compilerVersion: string;
  computedAt: string;
}
