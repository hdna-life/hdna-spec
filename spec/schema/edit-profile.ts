/**
 * T1 statistical profile: an incrementally-updated aggregate over every
 * EditMetrics observed so far. Updated online (existing aggregate + one new
 * observation), never by rescanning full history — per the design doc's
 * "Incremental computation" principle. Derived — rebuildable by replaying
 * EditMetrics from scratch.
 */
export interface EditProfile {
  sampleCount: number;
  meanEditDistance: number;
  meanCompressionRatio: number;
  meanLexicalOverlap: number;
  updatedAt: string;
}

export const EMPTY_EDIT_PROFILE: Omit<EditProfile, 'updatedAt'> = {
  sampleCount: 0,
  meanEditDistance: 0,
  meanCompressionRatio: 0,
  meanLexicalOverlap: 0,
};
