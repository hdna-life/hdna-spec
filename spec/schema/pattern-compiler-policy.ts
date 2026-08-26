/**
 * Evidence thresholds gating pattern compilation, per the design doc's
 * "evidence thresholds, deterministic triggers" requirement: a
 * (dimension, context) group that hasn't crossed these thresholds produces
 * no Pattern at all, rather than an unreliable one.
 */
export interface PatternCompilerPolicy {
  minSampleCount: number;
  minConfidenceWeight: number;
}

export const DEFAULT_PATTERN_COMPILER_POLICY: PatternCompilerPolicy = {
  minSampleCount: 3,
  minConfidenceWeight: 1.5,
};
