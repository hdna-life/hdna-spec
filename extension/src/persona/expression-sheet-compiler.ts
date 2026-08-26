import type { ExpressionSheet } from '@spec/schema/expression-sheet';
import {
  computeEmojiUsageRate,
  computeLowercaseStartProbability,
  computePunctuationPer100Sentences,
  computeSentenceLengthDistribution,
} from './stylometry';

/**
 * Deterministic compiler: real writing samples -> Expression Sheet.
 * Populates only MVP_REQUIRED fields (see spec/schema/expression-sheet.ts's
 * EXPRESSION_SHEET_FIELD_STATUS). No model call, no randomness.
 */
export function compileExpressionSheet(
  samples: string[],
  now: () => string = () => new Date().toISOString(),
): ExpressionSheet {
  return {
    sentenceLengthTokens: computeSentenceLengthDistribution(samples),
    punctuationPer100Sentences: computePunctuationPer100Sentences(samples),
    lowercaseStartProbability: computeLowercaseStartProbability(samples),
    emojiUsageRate: computeEmojiUsageRate(samples),
    updatedAt: now(),
  };
}
