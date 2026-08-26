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

const NON_ASCII_LETTER_RATIO_THRESHOLD = 0.02;

function nonAsciiLetterRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  let nonAscii = 0;
  for (const ch of letters) {
    if (!/[A-Za-z]/.test(ch)) nonAscii += 1;
  }
  return nonAscii / letters.length;
}

/**
 * Deterministic, language-agnostic applicability gate for this classifier's
 * English-lexicon/calibration-dependent heuristics: the hedge-phrase list
 * (`scoreDirectness`), the contraction pattern, and the word-length-to-
 * formality calibration (`scoreFormality`) were all implicitly tuned
 * against English. Applied to text in another language, they don't fail
 * loudly — `HEDGE_PHRASES` simply never matches non-English text, which
 * silently produces a confidently-wrong "fully direct" (1.0) score rather
 * than "no signal." Word length is worse: it's a real but language-specific
 * confound — agglutinative languages (Turkish among them) structurally
 * produce longer average word lengths via suffix stacking, independent of
 * actual formality, so `scoreFormality` reads as systematically more formal
 * for such languages regardless of register.
 *
 * Rather than attempting general language identification (its own
 * ML-shaped problem, out of scope for a dependency-free heuristic
 * classifier), this checks for non-ASCII letters — e.g. Turkish
 * ç/ğ/ı/ö/ş/ü, or other Latin-script diacritics (French, German, etc.).
 * Genuine English prose is overwhelmingly plain ASCII a-z; most other
 * Latin-script languages are not. This is deliberately conservative (a
 * single stray non-ASCII character among many words won't flip the
 * verdict — it's a ratio, not a presence check) and deliberately narrow in
 * scope: it does not detect every non-English language (romanized/ASCII-
 * only text in another language still passes) — a documented boundary, not
 * an attempt at general language ID. See docs/decisions/0012.
 */
export function isLikelyEnglish(text: string): boolean {
  return nonAsciiLetterRatio(text) <= NON_ASCII_LETTER_RATIO_THRESHOLD;
}

/**
 * Formality heuristic (0 informal .. 1 formal): longer average word length
 * pulls toward formal; contractions, emoji, and exclamation marks pull
 * toward informal. A crude, explicitly documented approximation — not a
 * validated formality measure. See docs/decisions/0010. Abstains (zero
 * confidence) for text that doesn't pass `isLikelyEnglish` — see that
 * function's doc comment and docs/decisions/0012 for why.
 */
export function scoreFormality(text: string): { score: number; confidence: number } {
  const words = splitWords(text);
  if (words.length === 0) return { score: 0.5, confidence: 0 };
  if (!isLikelyEnglish(text)) return { score: 0.5, confidence: 0 };

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
 *
 * This dimension is the most exposed to the English-only lexicon problem:
 * with zero hedge-phrase matches (guaranteed for non-English text, since
 * the list is English-only), the raw formula collapses to a constant 1.0
 * ("fully direct") — a confidently wrong, saturated reading, not an absence
 * of signal. Abstains (zero confidence) for text that doesn't pass
 * `isLikelyEnglish` — see that function's doc comment and
 * docs/decisions/0012.
 */
export function scoreDirectness(text: string): { score: number; confidence: number } {
  const words = splitWords(text);
  if (words.length === 0) return { score: 0.5, confidence: 0 };
  if (!isLikelyEnglish(text)) return { score: 0.5, confidence: 0 };

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
 *
 * Both implemented dimensions rely on English-specific lexicons/calibration
 * (see `isLikelyEnglish`) and abstain — omitting the dimension from `scores`/
 * `confidence` entirely, not emitting a fabricated neutral value — for text
 * that doesn't pass that gate. This reuses the same Partial<> "not computed"
 * mechanism already used for the SPEC_RESERVED dimensions, so downstream
 * aggregation (`applyTraitScore`) and pattern compilation already skip
 * omitted dimensions with no further changes needed. See docs/decisions/0012.
 */
export class HeuristicTinyClassifier implements TinyClassifier {
  readonly extractorId = 'heuristic-lexical';
  readonly extractorVersion = '1.0.0';

  async classify(text: string): Promise<TinyClassifierResult> {
    const formality = scoreFormality(text);
    const directness = scoreDirectness(text);

    const scores: TinyClassifierResult['scores'] = {};
    const confidence: TinyClassifierResult['confidence'] = {};

    if (formality.confidence > 0) {
      scores.formality = formality.score;
      confidence.formality = formality.confidence;
    }
    if (directness.confidence > 0) {
      scores.directness = directness.score;
      confidence.directness = directness.confidence;
    }

    return { scores, confidence };
  }
}
