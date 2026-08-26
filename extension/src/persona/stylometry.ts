import type { StatDistribution } from '@spec/schema/expression-sheet';

const PUNCTUATION_MARKS = ['.', ',', '!', '?', ';', ':', '...', '-'] as const;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;

/**
 * Naive, deterministic sentence splitter: split on '.', '!', '?' followed by
 * whitespace/end-of-string. Does not handle abbreviations or decimal numbers
 * correctly — an intentional MVP simplification (T0 telemetry per the design
 * doc must stay model-free and deterministic; a smarter splitter can replace
 * this without changing any caller).
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitWords(sentence: string): string[] {
  return sentence.split(/\s+/).filter((w) => w.length > 0);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: number[], avg: number): number {
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

/** Token (word) count distribution across every sentence in every sample. */
export function computeSentenceLengthDistribution(samples: string[]): StatDistribution | undefined {
  const lengths = samples.flatMap((s) => splitSentences(s).map((sentence) => splitWords(sentence).length));
  if (lengths.length === 0) return undefined;

  const avg = mean(lengths);
  return {
    mean: avg,
    median: median(lengths),
    stddev: stddev(lengths, avg),
    sampleSize: lengths.length,
  };
}

/** Occurrences of each tracked punctuation mark, normalized per 100 sentences. */
export function computePunctuationPer100Sentences(samples: string[]): Record<string, number> | undefined {
  const sentences = samples.flatMap(splitSentences);
  if (sentences.length === 0) return undefined;

  const fullText = samples.join(' ');
  const counts: Record<string, number> = {};
  for (const mark of PUNCTUATION_MARKS) {
    const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = fullText.match(new RegExp(escaped, 'g'));
    counts[mark] = ((matches?.length ?? 0) / sentences.length) * 100;
  }
  return counts;
}

/**
 * Fraction of sentences whose first alphabetic character is lowercase.
 *
 * Uses a Unicode letter class (not `[a-zA-Z]`) so the first letter of a
 * sentence is found correctly even when it's a Turkish-specific character
 * (ç, ğ, ı, ö, ş, ü and their uppercase forms) — `[a-zA-Z]` would skip past
 * them and match the wrong, later letter instead. Case comparison uses the
 * `tr` locale so the dotted/dotless I distinction (İ/I vs i/ı) folds
 * correctly; this also folds plain ASCII text correctly since `tr` locale
 * casing only differs from the default for the I/İ/i/ı family.
 */
export function computeLowercaseStartProbability(samples: string[]): number | undefined {
  const sentences = samples.flatMap(splitSentences);
  if (sentences.length === 0) return undefined;

  let lowercaseStarts = 0;
  for (const sentence of sentences) {
    const firstLetter = sentence.match(/\p{L}/u)?.[0];
    if (firstLetter && firstLetter === firstLetter.toLocaleLowerCase('tr')) {
      lowercaseStarts += 1;
    }
  }
  return lowercaseStarts / sentences.length;
}

/** Emoji count per word, across all samples. */
export function computeEmojiUsageRate(samples: string[]): number | undefined {
  const words = samples.flatMap((s) => splitWords(s));
  if (words.length === 0) return undefined;

  const emojiCount = samples.reduce((total, sample) => {
    const matches = sample.match(EMOJI_PATTERN);
    return total + (matches?.length ?? 0);
  }, 0);
  return emojiCount / words.length;
}
