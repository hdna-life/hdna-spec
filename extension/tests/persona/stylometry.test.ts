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
