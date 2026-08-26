import type { EditMetrics } from '@spec/schema/edit-metrics';
import { EMPTY_EDIT_PROFILE, type EditProfile } from '@spec/schema/edit-profile';

/** Numerically-stable online mean update: newMean = oldMean + (value - oldMean) / newCount. */
function incrementalMean(oldMean: number, newCount: number, value: number): number {
  return oldMean + (value - oldMean) / newCount;
}

/**
 * Folds one new EditMetrics observation into the existing profile without
 * rescanning any prior history — the profile itself is the only state
 * carried forward.
 */
export function applyEditMetrics(
  profile: EditProfile | undefined,
  metrics: EditMetrics,
  now: () => string = () => new Date().toISOString(),
): EditProfile {
  const current = profile ?? { ...EMPTY_EDIT_PROFILE, updatedAt: now() };
  const sampleCount = current.sampleCount + 1;

  return {
    sampleCount,
    meanEditDistance: incrementalMean(current.meanEditDistance, sampleCount, metrics.editDistance),
    meanCompressionRatio: incrementalMean(current.meanCompressionRatio, sampleCount, metrics.compressionRatio),
    meanLexicalOverlap: incrementalMean(current.meanLexicalOverlap, sampleCount, metrics.lexicalOverlap),
    updatedAt: now(),
  };
}
