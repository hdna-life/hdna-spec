import { describe, expect, it } from 'vitest';
import {
  HeuristicTinyClassifier,
  isLikelyEnglish,
  scoreDirectness,
  scoreFormality,
} from '../../src/persona/t2-classifier';
import { T2_DIMENSION_STATUS } from '@spec/schema/t2-dimensions';

// Real, natural sentences — not a keyword-list patch — used to regression-test
// the reported bug (Turkish evidence saturating directness at 1.0) and to
// prove the fix generalizes beyond Turkish specifically.
const TURKISH_TEXT = 'Bugün hava çok güzeldi ve dışarıda uzun bir yürüyüş yaptım.';
const TURKISH_TEXT_WITH_LOANWORD = 'Sanırım bu proje için email göndermem lazım, ok mu?';
// Same sentences as TURKISH_TEXT, with diacritics stripped to their plain-ASCII
// equivalents — extremely common in real-world Turkish typing (non-Turkish
// keyboards, texting habits). A non-ASCII-character check alone is blind to
// this; it's the case that exposed the gap in the first version of this fix.
const TURKISH_TEXT_ASCII_ONLY = 'Bugun hava cok guzeldi ve disarida uzun bir yuruyus yaptim.';
const TURKISH_TEXT_ASCII_ONLY_2 = 'Bu urunu cok begendim, gercekten harika bir deneyimdi.';
const FRENCH_TEXT = "J'ai déjà terminé mon travail aujourd'hui.";
const GERMAN_TEXT = 'Ich möchte gerne wissen, ob das möglich ist.';

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
    // 25 real English words (not a degenerate repeated token, which the
    // function-word-density half of isLikelyEnglish would correctly reject).
    const long = scoreFormality(
      'This is a longer piece of writing that contains many different words so that the word count comfortably exceeds twenty.',
    );
    expect(long.confidence).toBeGreaterThan(short.confidence);
    expect(long.confidence).toBe(1);
  });

  it('is deterministic', () => {
    const text = 'This is a perfectly ordinary sentence.';
    expect(scoreFormality(text)).toEqual(scoreFormality(text));
  });

  it('abstains (zero confidence) for Turkish text instead of applying an English-calibrated word-length bias (regression)', () => {
    expect(scoreFormality(TURKISH_TEXT)).toEqual({ score: 0.5, confidence: 0 });
  });

  it('abstains for French and German text too — not a Turkish-only patch', () => {
    expect(scoreFormality(FRENCH_TEXT)).toEqual({ score: 0.5, confidence: 0 });
    expect(scoreFormality(GERMAN_TEXT)).toEqual({ score: 0.5, confidence: 0 });
  });

  it('abstains for Turkish text with diacritics stripped to plain ASCII (regression: a non-ASCII-only gate is blind to this)', () => {
    expect(scoreFormality(TURKISH_TEXT_ASCII_ONLY)).toEqual({ score: 0.5, confidence: 0 });
    expect(scoreFormality(TURKISH_TEXT_ASCII_ONLY_2)).toEqual({ score: 0.5, confidence: 0 });
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

  it('abstains (zero confidence) for Turkish text instead of saturating at 1.0 (regression for the reported bug)', () => {
    // Before the fix: zero matches against the English-only HEDGE_PHRASES
    // list deterministically produced score 1.0 ("fully direct") at full
    // word-count-scaled confidence — a confidently wrong reading, not an
    // absence of signal. 35/35 real Turkish samples reproduced this.
    expect(scoreDirectness(TURKISH_TEXT)).toEqual({ score: 0.5, confidence: 0 });
  });

  it('abstains for French and German text too — not a Turkish-only patch', () => {
    expect(scoreDirectness(FRENCH_TEXT)).toEqual({ score: 0.5, confidence: 0 });
    expect(scoreDirectness(GERMAN_TEXT)).toEqual({ score: 0.5, confidence: 0 });
  });

  it('still abstains when non-English text contains an English loanword (robust to code-switching)', () => {
    // A single borrowed word ("email", "ok") must not flip the verdict —
    // the surrounding text is still overwhelmingly non-ASCII-lettered.
    expect(scoreDirectness(TURKISH_TEXT_WITH_LOANWORD)).toEqual({ score: 0.5, confidence: 0 });
  });

  it('abstains for Turkish text with diacritics stripped to plain ASCII (regression: a non-ASCII-only gate is blind to this)', () => {
    // This is the concrete gap the operator asked to be demonstrated: an
    // earlier version of isLikelyEnglish() checked only non-ASCII letter
    // ratio, which is 0% for ASCII-transliterated Turkish — indistinguishable
    // from English by that signal alone. Without the added function-word
    // check, this assertion would fail (score 1.0, confidence > 0).
    expect(scoreDirectness(TURKISH_TEXT_ASCII_ONLY)).toEqual({ score: 0.5, confidence: 0 });
    expect(scoreDirectness(TURKISH_TEXT_ASCII_ONLY_2)).toEqual({ score: 0.5, confidence: 0 });
  });
});

describe('isLikelyEnglish', () => {
  it('accepts plain-ASCII English text, including formal register (low function-word density)', () => {
    expect(isLikelyEnglish('The quarterly financial statements demonstrate substantial improvement.')).toBe(true);
  });

  it('accepts casual English text with contractions and emoji', () => {
    expect(isLikelyEnglish("omg that's so cool!! 🎉🎉 can't wait!!!")).toBe(true);
  });

  it('rejects Turkish text', () => {
    expect(isLikelyEnglish(TURKISH_TEXT)).toBe(false);
  });

  it('rejects French and German text', () => {
    expect(isLikelyEnglish(FRENCH_TEXT)).toBe(false);
    expect(isLikelyEnglish(GERMAN_TEXT)).toBe(false);
  });

  it('is not fooled by a single English loanword inside otherwise non-English text', () => {
    expect(isLikelyEnglish(TURKISH_TEXT_WITH_LOANWORD)).toBe(false);
  });

  it('rejects ASCII-only (diacritic-stripped) Turkish text via the function-word-density signal', () => {
    expect(isLikelyEnglish(TURKISH_TEXT_ASCII_ONLY)).toBe(false);
    expect(isLikelyEnglish(TURKISH_TEXT_ASCII_ONLY_2)).toBe(false);
  });

  it('still accepts terse/short English text as long as it clears the function-word floor', () => {
    expect(isLikelyEnglish('Ship the release today.')).toBe(true);
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

  it('omits both dimensions entirely for non-English text, rather than emitting fabricated values (regression)', async () => {
    const result = await classifier.classify(TURKISH_TEXT);
    expect(result.scores).toEqual({});
    expect(result.confidence).toEqual({});
  });

  it('omits both dimensions for ASCII-only Turkish text too (the diacritic-stripped case)', async () => {
    const result = await classifier.classify(TURKISH_TEXT_ASCII_ONLY);
    expect(result.scores).toEqual({});
    expect(result.confidence).toEqual({});
  });

  it('still populates both dimensions for confidently-English text', async () => {
    const result = await classifier.classify('This is a reasonably ordinary test sentence for classification.');
    expect(Object.keys(result.scores).sort()).toEqual(['directness', 'formality']);
    expect(Object.keys(result.confidence).sort()).toEqual(['directness', 'formality']);
  });
});
