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
const MIN_ENGLISH_FUNCTION_WORD_RATIO = 0.05;

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
 * Common English closed-class function words (articles, pronouns,
 * copula/auxiliary/modal verbs, prepositions, conjunctions) plus their
 * common contracted forms. Closed-class words are a standard, robust
 * language discriminator: they're extremely frequent in genuine text of
 * their language and — unlike open-class content words — essentially never
 * borrowed across languages, so they catch non-English text that a
 * character-based check alone cannot (see `isLikelyEnglish`).
 */
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'as', 'if', 'so',
  'than', 'then', 'there', 'here', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'no',
  'i', 'you', 'he', 'she', 'we', 'they', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
  'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
  "he's", "she's", "it's", "we're", "we've", "we'll", "they're", "they've", "they'll",
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "can't", "couldn't", "won't", "wouldn't", "shouldn't", "that's", "there's", "what's",
]);

function normalizeForFunctionWordCheck(word: string): string {
  return word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

function englishFunctionWordRatio(text: string): number {
  const words = splitWords(text);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => ENGLISH_FUNCTION_WORDS.has(normalizeForFunctionWordCheck(w))).length;
  return hits / words.length;
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
 * Two independent, complementary signals, both required:
 *
 * 1. Non-ASCII letters (e.g. Turkish ç/ğ/ı/ö/ş/ü, or other Latin-script
 *    diacritics) — catches diacritic-bearing non-English text. Genuine
 *    English prose is overwhelmingly plain ASCII a-z.
 * 2. English function-word density — catches non-English text written
 *    *without* diacritics (e.g. Turkish typed on a non-Turkish keyboard,
 *    extremely common in practice), which the character-based check alone
 *    is blind to: stripped of diacritics, "Bugün hava güzeldi" becomes
 *    "Bugun hava guzeldi," pure ASCII, and would silently pass a
 *    character-only gate. Function words don't survive that transcription
 *    problem, because Turkish words don't happen to collide with English
 *    ones the way Turkish's Latin-alphabet letters can. A first version of
 *    this gate used only the non-ASCII check and was rejected — see
 *    docs/decisions/0012 for the ASCII-only-Turkish regression that exposed
 *    the gap, and why plain function-word density alone (checked first) was
 *    also rejected: formal-register English has measurably lower
 *    function-word density than casual English (~9% vs ~40-50% observed
 *    against this file's own fixtures), which put a single global threshold
 *    uncomfortably close to misclassifying formal English as non-English —
 *    exactly the register this classifier exists to distinguish. Requiring
 *    *both* signals removes that tension: the non-ASCII check needs no
 *    register-sensitive threshold, and the function-word check only has to
 *    clear a low floor once, not carry the whole decision.
 *
 * Deliberately not general language identification (its own ML-shaped
 * problem, out of scope for a dependency-free heuristic classifier) — a
 * documented boundary. Text in a non-English language that is both
 * ASCII-only *and* happens to reuse enough English function words (rare,
 * but not impossible for heavily code-mixed text) can still pass.
 */
export function isLikelyEnglish(text: string): boolean {
  return (
    nonAsciiLetterRatio(text) <= NON_ASCII_LETTER_RATIO_THRESHOLD &&
    englishFunctionWordRatio(text) >= MIN_ENGLISH_FUNCTION_WORD_RATIO
  );
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
