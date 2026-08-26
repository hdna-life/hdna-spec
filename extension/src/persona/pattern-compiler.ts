import type { Pattern } from '@spec/schema/pattern';
import type { PatternCompilerPolicy } from '@spec/schema/pattern-compiler-policy';

export const PATTERN_COMPILER_ID = 'deterministic-aggregate';
export const PATTERN_COMPILER_VERSION = '1.0.0';

export interface ScoredObservation {
  dimension: string;
  context: string;
  value: number;
  confidence: number;
  /** Composite id ("sourceType:sourceId") of the derived-evidence record this observation came from. */
  recordId: string;
}

interface GroupKey {
  dimension: string;
  context: string;
}

function groupKeyString(key: GroupKey): string {
  return JSON.stringify(key);
}

/**
 * Pure evidence-threshold aggregation: groups observations by
 * (dimension, context), computes a confidence-weighted mean per group, and
 * emits a Pattern only for groups that cross the policy's thresholds — the
 * design doc's "yeterli değilse hiçbir [pattern] yapılmaz" rule. No I/O, no
 * model call.
 */
export function aggregateObservations(
  observations: ScoredObservation[],
  policy: PatternCompilerPolicy,
  now: () => string = () => new Date().toISOString(),
): Pattern[] {
  const groups = new Map<string, { key: GroupKey; observations: ScoredObservation[] }>();
  for (const obs of observations) {
    const key: GroupKey = { dimension: obs.dimension, context: obs.context };
    const groupKey = groupKeyString(key);
    const existing = groups.get(groupKey);
    if (existing) existing.observations.push(obs);
    else groups.set(groupKey, { key, observations: [obs] });
  }

  const patterns: Pattern[] = [];
  for (const { key, observations: group } of groups.values()) {
    let weightedSum = 0;
    let confidenceWeight = 0;
    for (const obs of group) {
      weightedSum += obs.value * obs.confidence;
      confidenceWeight += obs.confidence;
    }

    if (group.length < policy.minSampleCount || confidenceWeight < policy.minConfidenceWeight) continue;

    patterns.push({
      dimension: key.dimension,
      context: key.context,
      value: confidenceWeight === 0 ? 0 : weightedSum / confidenceWeight,
      confidenceWeight,
      sampleCount: group.length,
      supportingRecordIds: group.map((obs) => obs.recordId),
      compilerId: PATTERN_COMPILER_ID,
      compilerVersion: PATTERN_COMPILER_VERSION,
      computedAt: now(),
    });
  }

  return patterns;
}
