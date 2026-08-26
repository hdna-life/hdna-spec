import type { T2DimensionAggregate, T2Profile } from '@spec/schema/t2-profile';
import type { TraitScoreRecord } from '@spec/schema/trait-score';

/** Only the two dimensions T2Profile actually has fields for — see spec/schema/t2-profile.ts. */
const T2_PROFILE_DIMENSIONS = ['formality', 'directness'] as const;

function applyDimensionScore(
  current: T2DimensionAggregate | undefined,
  score: number,
  confidence: number,
): T2DimensionAggregate {
  const base = current ?? { weightedMeanScore: 0, totalConfidenceWeight: 0, sampleCount: 0 };
  const newWeight = base.totalConfidenceWeight + confidence;
  const weightedMeanScore =
    newWeight === 0 ? base.weightedMeanScore : (base.weightedMeanScore * base.totalConfidenceWeight + score * confidence) / newWeight;

  return {
    weightedMeanScore,
    totalConfidenceWeight: newWeight,
    sampleCount: base.sampleCount + 1,
  };
}

/**
 * Folds one new TraitScoreRecord into the existing T2Profile, per dimension,
 * without rescanning any prior history — same incremental-update principle
 * as EditProfile's applyEditMetrics(). A dimension absent from the record's
 * `scores` (e.g. because the classifier didn't compute it) leaves that
 * dimension's aggregate untouched.
 */
export function applyTraitScore(
  profile: T2Profile | undefined,
  record: TraitScoreRecord,
  now: () => string = () => new Date().toISOString(),
): T2Profile {
  const next: T2Profile = { ...profile, updatedAt: now() };

  for (const dimension of T2_PROFILE_DIMENSIONS) {
    const score = record.scores[dimension];
    const confidence = record.confidence[dimension];
    if (score === undefined || confidence === undefined) continue;
    next[dimension] = applyDimensionScore(profile?.[dimension], score, confidence);
  }

  return next;
}
