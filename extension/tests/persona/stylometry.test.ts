import { describe, expect, it } from 'vitest';
import {
  computeEmojiUsageRate,
  computeLowercaseStartProbability,
  computePunctuationPer100Sentences,
  computeSentenceLengthDistribution,
  splitSentences,
  splitWords,
} from '../../src/persona/stylometry';

describe('splitSentences', () => {
  it('splits on sentence-ending punctuation followed by whitespace', () => {
    expect(splitSentences('Hello world. How are you? Fine!')).toEqual([
      'Hello world.',
      'How are you?',
      'Fine!',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('trims and drops empty fragments', () => {
    expect(splitSentences('One.   Two.')).toEqual(['One.', 'Two.']);
  });
});

describe('splitWords', () => {
  it('splits on whitespace and drops empty tokens', () => {
    expect(splitWords('  hello   world  ')).toEqual(['hello', 'world']);
  });
});

describe('computeSentenceLengthDistribution', () => {
  it('returns undefined for no samples', () => {
    expect(computeSentenceLengthDistribution([])).toBeUndefined();
  });

  it('computes mean/median/stddev/sampleSize across sentences', () => {
    // Sentence token counts: "a b." -> 2, "c d e." -> 3
    const dist = computeSentenceLengthDistribution(['a b. c d e.']);
    expect(dist).toEqual({
      mean: 2.5,
      median: 2.5,
      stddev: 0.5,
      sampleSize: 2,
    });
  });
});

describe('computePunctuationPer100Sentences', () => {
  it('returns undefined for no samples', () => {
    expect(computePunctuationPer100Sentences([])).toBeUndefined();
  });

  it('normalizes punctuation counts per 100 sentences', () => {
    // 2 sentences, one comma total -> comma rate = 50 per 100 sentences
    const counts = computePunctuationPer100Sentences(['Hi, there. Bye.']);
    expect(counts?.[',']).toBe(50);
    expect(counts?.['.']).toBe(100);
  });
});

describe('computeLowercaseStartProbability', () => {
  it('returns undefined for no samples', () => {
    expect(computeLowercaseStartProbability([])).toBeUndefined();
  });

  it('computes the fraction of sentences starting lowercase', () => {
    // "hi there." lowercase start, "Bye." uppercase start -> 0.5
    expect(computeLowercaseStartProbability(['hi there. Bye.'])).toBe(0.5);
  });

  it('treats all-lowercase text as probability 1', () => {
    expect(computeLowercaseStartProbability(['hello world.'])).toBe(1);
  });

  it('finds the true first letter of a sentence starting with a Turkish-specific character, not the first ASCII letter', () => {
    // "Şimdi geldi." starts with uppercase Ş; [a-zA-Z] would wrongly skip to
    // the lowercase "i" in "imdi" and misclassify this as a lowercase start.
    expect(computeLowercaseStartProbability(['Şimdi geldi.'])).toBe(0);
  });

  it('recognizes lowercase Turkish-specific starting letters', () => {
    expect(computeLowercaseStartProbability(['şimdi gitti.'])).toBe(1);
  });

  it('applies Turkish-locale casing so dotted/dotless I folds correctly', () => {
    // "İstanbul" (dotted capital İ) is uppercase; under default-locale
    // toLowerCase() it folds to plain "i", which happens to equal the
    // ASCII "i" — a trap that could hide this bug. Under the tr locale it
    // folds to "i" as well, but the *comparison* against the actual first
    // character "İ" correctly stays unequal, so this is still detected as
    // an uppercase start.
    expect(computeLowercaseStartProbability(['İstanbul güzel.'])).toBe(0);
    expect(computeLowercaseStartProbability(['ıstanbul güzel.'])).toBe(1);
  });

  it('computes a mixed Turkish/ASCII distribution correctly', () => {
    // "Şimdi geldi." uppercase start, "şimdi gitti." lowercase start -> 0.5
    expect(computeLowercaseStartProbability(['Şimdi geldi. şimdi gitti.'])).toBe(0.5);
  });
});

describe('computeEmojiUsageRate', () => {
  it('returns undefined for no samples', () => {
    expect(computeEmojiUsageRate([])).toBeUndefined();
  });

  it('computes emoji count per word', () => {
    // 4 words, 1 emoji -> 0.25
    expect(computeEmojiUsageRate(['this is great 🎉'])).toBe(0.25);
  });

  it('returns 0 when no emoji are present', () => {
    expect(computeEmojiUsageRate(['plain text here'])).toBe(0);
  });
});
