import type { EditEvent } from '@spec/schema/edit-event';
import type { EditMetrics } from '@spec/schema/edit-metrics';
import { splitSentences, splitWords } from './stylometry';

/** Classic O(n*m) edit-distance DP. Deterministic, no external dependency. */
export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[rows - 1][cols - 1];
}

/** Jaccard similarity of the two texts' lowercased word sets. 1 for two empty texts. */
export function jaccardWordOverlap(a: string, b: string): number {
  const setA = new Set(splitWords(a.toLowerCase()));
  const setB = new Set(splitWords(b.toLowerCase()));
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function computeEditMetrics(
  event: EditEvent,
  now: () => string = () => new Date().toISOString(),
): EditMetrics {
  const { sourceText, finalText } = event;
  return {
    editEventId: event.id,
    editDistance: levenshteinDistance(sourceText, finalText),
    compressionRatio: sourceText.length === 0 ? 1 : finalText.length / sourceText.length,
    sentenceCountChange: splitSentences(finalText).length - splitSentences(sourceText).length,
    lexicalOverlap: jaccardWordOverlap(sourceText, finalText),
    computedAt: now(),
  };
}
