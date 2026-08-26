/**
 * Expression Sheet: compact, deterministic writing-style profile referenced
 * by the design doc's MVP hypothesis. Schema only in this PR — no field is
 * populated by any extractor yet (that is Phase 2 deterministic telemetry,
 * out of scope for the MVP foundation).
 *
 * Every field is tagged MVP_REQUIRED or SPEC_RESERVED per the doc's
 * "MVP Scope and Deferred Architecture Rule": MVP_REQUIRED fields are the
 * ones the current MVP hypothesis needs; SPEC_RESERVED fields reserve shape
 * for later phases without being implemented now.
 */

export type FieldStatus = 'MVP_REQUIRED' | 'SPEC_RESERVED';

export interface StatDistribution {
  mean: number;
  median: number;
  stddev: number;
  sampleSize: number;
}

export interface ExpressionSheet {
  /** MVP_REQUIRED — T0 deterministic telemetry basis for style transform. */
  sentenceLengthTokens?: StatDistribution;
  /** MVP_REQUIRED */
  punctuationPer100Sentences?: Record<string, number>;
  /** MVP_REQUIRED */
  lowercaseStartProbability?: number;
  /** MVP_REQUIRED */
  emojiUsageRate?: number;

  /** SPEC_RESERVED — Phase 7 speech schema. */
  prosody?: unknown;
  /** SPEC_RESERVED — Phase 7 visual/gesture schema. */
  gestureProfile?: unknown;
  /** SPEC_RESERVED — Phase 3 tiny-classifier derived dimensions. */
  formality?: number;
  /** SPEC_RESERVED */
  directness?: number;
  /** SPEC_RESERVED */
  warmth?: number;

  updatedAt: string;
}

/** Companion map used by tooling/tests to assert no SPEC_RESERVED field is ever populated by MVP code. */
export const EXPRESSION_SHEET_FIELD_STATUS: Record<
  Exclude<keyof ExpressionSheet, 'updatedAt'>,
  FieldStatus
> = {
  sentenceLengthTokens: 'MVP_REQUIRED',
  punctuationPer100Sentences: 'MVP_REQUIRED',
  lowercaseStartProbability: 'MVP_REQUIRED',
  emojiUsageRate: 'MVP_REQUIRED',
  prosody: 'SPEC_RESERVED',
  gestureProfile: 'SPEC_RESERVED',
  formality: 'SPEC_RESERVED',
  directness: 'SPEC_RESERVED',
  warmth: 'SPEC_RESERVED',
};
