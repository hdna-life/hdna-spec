import type { TinyClassifier, TinyClassifierResult } from '@spec/protocol/tiny-classifier';
import { splitWords } from './stylometry';

const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;
const CONTRACTION_PATTERN = /\b\w+'(t|re|ve|ll|d|s|m)\b/gi;
const HEDGE_PHRASES = [
  'maybe',
  'perhaps',
  'possibly',
  'probably',
  'might',
  'could',
  'i think',
  'i guess',
  'i feel like',
  'sort of',
  'kind of',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** More words = more confidence, saturating at 20 words. Empty/near-empty text gets near-zero confidence. */
function confidenceFromWordCount(wordCount: number): number {
  return clamp(wordCount / 20, 0, 1);
}

/**
 * Formality heuristic (0 informal .. 1 formal): longer average word length
 * pulls toward formal; contractions, emoji, and exclamation marks pull
 * toward informal. A crude, explicitly documented approximation — not a
 * validated formality measure. See docs/decisions/0010.
 */
export function scoreFormality(text: string): { score: number; confidence: number } {
  const words = splitWords(text);
  if (words.length === 0) return { score: 0.5, confidence: 0 };

  const meanWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const wordLengthScore = clamp((meanWordLength - 3) / (8 - 3), 0, 1);

  const contractionRate = (text.match(CONTRACTION_PATTERN)?.length ?? 0) / words.length;
  const emojiRate = (text.match(EMOJI_PATTERN)?.length ?? 0) / words.length;
  const exclamationRate = (text.match(/!/g)?.length ?? 0) / words.length;

  const informalPenalty =
    clamp(contractionRate * 2, 0, 1) * 0.4 + clamp(emojiRate * 5, 0, 1) * 0.3 + clamp(exclamationRate * 5, 0, 1) * 0.3;

  const score = clamp(wordLengthScore * 0.5 + (1 - informalPenalty) * 0.5, 0, 1);
  return { score, confidence: confidenceFromWordCount(words.length) };
}

/**
 * Directness heuristic (0 indirect/hedged .. 1 direct): frequency of hedge
 * phrases ("maybe", "I think", "sort of", ...) pulls toward indirect. A
 * crude, explicitly documented approximation. See docs/decisions/0010.
 */
export function scoreDirectness(text: string): { score: number; confidence: number } {
  const words = splitWords(text);
  if (words.length === 0) return { score: 0.5, confidence: 0 };

  const lower = text.toLowerCase();
  let hedgeCount = 0;
  for (const phrase of HEDGE_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    hedgeCount += lower.match(new RegExp(`\\b${escaped}\\b`, 'g'))?.length ?? 0;
  }
  const hedgeRate = hedgeCount / words.length;

  const score = clamp(1 - hedgeRate * 8, 0, 1);
  return { score, confidence: confidenceFromWordCount(words.length) };
}

/**
 * Deterministic, dependency-free T2 classifier baseline covering only
 * formality and directness — the two dimensions with the clearest
 * heuristic signal. The remaining five T2 dimensions (SPEC_RESERVED in
 * T2_DIMENSION_STATUS) are intentionally not attempted here; sarcasm in
 * particular needs conservative handling a simple heuristic can't provide.
 */
export class HeuristicTinyClassifier implements TinyClassifier {
  readonly extractorId = 'heuristic-lexical';
  readonly extractorVersion = '1.0.0';

  async classify(text: string): Promise<TinyClassifierResult> {
    const formality = scoreFormality(text);
    const directness = scoreDirectness(text);
    return {
      scores: { formality: formality.score, directness: directness.score },
      confidence: { formality: formality.confidence, directness: directness.confidence },
    };
  }
}
