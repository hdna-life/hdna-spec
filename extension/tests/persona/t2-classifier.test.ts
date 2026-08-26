import { describe, expect, it } from 'vitest';
import { HeuristicTinyClassifier, scoreDirectness, scoreFormality } from '../../src/persona/t2-classifier';
import { T2_DIMENSION_STATUS } from '@spec/schema/t2-dimensions';

describe('scoreFormality', () => {
  it('returns a neutral score with zero confidence for empty text', () => {
    expect(scoreFormality('')).toEqual({ score: 0.5, confidence: 0 });
  });

  it('scores contraction-heavy, emoji-laden, exclamatory text as less formal than plain long-word text', () => {
    const informal = scoreFormality("omg that's so cool!! 🎉🎉 can't wait!!!");
    const formal = scoreFormality(
      'The quarterly financial statements demonstrate substantial improvement across every operational category.',
    );
    expect(formal.score).toBeGreaterThan(informal.score);
  });

  it('increases confidence with word count, saturating at 20 words', () => {
    const short = scoreFormality('hi there');
    const long = scoreFormality('word '.repeat(25).trim());
    expect(long.confidence).toBeGreaterThan(short.confidence);
    expect(long.confidence).toBe(1);
  });

  it('is deterministic', () => {
    const text = 'This is a perfectly ordinary sentence.';
    expect(scoreFormality(text)).toEqual(scoreFormality(text));
  });
});

describe('scoreDirectness', () => {
  it('returns a neutral score with zero confidence for empty text', () => {
    expect(scoreDirectness('')).toEqual({ score: 0.5, confidence: 0 });
  });

  it('scores hedge-heavy text as less direct than assertive plain text', () => {
    const hedged = scoreDirectness('Maybe we could possibly try this, I think, sort of, if that seems ok');
    const direct = scoreDirectness('Do this now. Ship the release today.');
    expect(direct.score).toBeGreaterThan(hedged.score);
  });

  it('never goes below zero even with heavy hedging', () => {
    const veryHedged = scoreDirectness(
      'maybe perhaps possibly might could i think i guess sort of kind of probably i feel like',
    );
    expect(veryHedged.score).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic', () => {
    const text = 'I will finish this today.';
    expect(scoreDirectness(text)).toEqual(scoreDirectness(text));
  });
});

describe('HeuristicTinyClassifier', () => {
  const classifier = new HeuristicTinyClassifier();

  it('populates only the MVP_REQUIRED dimensions (formality, directness), never the SPEC_RESERVED ones', async () => {
    const result = await classifier.classify('This is a reasonably ordinary test sentence for classification.');

    for (const [dimension, status] of Object.entries(T2_DIMENSION_STATUS)) {
      const hasScore = dimension in result.scores;
      const hasConfidence = dimension in result.confidence;
      if (status === 'MVP_REQUIRED') {
        expect(hasScore, `${dimension} should have a score`).toBe(true);
        expect(hasConfidence, `${dimension} should have a confidence`).toBe(true);
      } else {
        expect(hasScore, `${dimension} is SPEC_RESERVED and must not be scored`).toBe(false);
        expect(hasConfidence, `${dimension} is SPEC_RESERVED and must not have confidence`).toBe(false);
      }
    }
  });

  it('exposes stable extractor identity metadata', () => {
    expect(classifier.extractorId).toBe('heuristic-lexical');
    expect(classifier.extractorVersion).toBe('1.0.0');
  });
});
