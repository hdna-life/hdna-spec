import { describe, expect, it } from 'vitest';
import { validateJudgmentDraft } from '../../src/persona/semantic-revision-judgment';
import type { SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';

describe('validateJudgmentDraft', () => {
  it('accepts no_meaningful_change with description null', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts uncertain with description null', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'uncertain', dimensions: [], description: null, confidence: 0.4 };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts meaning_added with a non-blank description', () => {
    const draft: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_added',
      dimensions: [],
      description: 'Added an explicit constraint.',
      confidence: 0.7,
    };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts meaning_removed with a non-blank description', () => {
    const draft: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_removed',
      dimensions: [],
      description: 'Removed a hedge.',
      confidence: 0.7,
    };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts meaning_transformed with a non-blank description', () => {
    const draft: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_transformed',
      dimensions: [],
      description: 'Shifted from conditional to unconditional.',
      confidence: 0.7,
    };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('rejects meaning_added with description null', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'meaning_added', dimensions: [], description: null, confidence: 0.7 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects meaning_removed with a blank/whitespace-only description', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'meaning_removed', dimensions: [], description: '   ', confidence: 0.7 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects meaning_transformed with an empty-string description', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'meaning_transformed', dimensions: [], description: '', confidence: 0.7 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects an out-of-range confidence (> 1)', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 1.1 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects an out-of-range confidence (< 0)', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'uncertain', dimensions: [], description: null, confidence: -0.1 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects a non-numeric confidence', () => {
    const draft = { verdict: 'uncertain', dimensions: [], description: null, confidence: 'high' } as unknown as SemanticRevisionJudgmentDraft;
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects an unrecognized verdict', () => {
    const draft = { verdict: 'trait_inferred', dimensions: [], description: 'x', confidence: 0.5 } as unknown as SemanticRevisionJudgmentDraft;
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  describe('dimensions (Test 1 addendum, docs/decisions/0017)', () => {
    it('accepts no_meaningful_change with a non-empty dimensions array', () => {
      const draft: SemanticRevisionJudgmentDraft = {
        verdict: 'no_meaningful_change',
        dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
        description: null,
        confidence: 0.8,
      };
      expect(validateJudgmentDraft(draft)).toBe(true);
    });

    it('accepts no_meaningful_change with an empty dimensions array', () => {
      const draft: SemanticRevisionJudgmentDraft = {
        verdict: 'no_meaningful_change',
        dimensions: [],
        description: null,
        confidence: 0.8,
      };
      expect(validateJudgmentDraft(draft)).toBe(true);
    });

    it('accepts uncertain with an empty dimensions array', () => {
      const draft: SemanticRevisionJudgmentDraft = {
        verdict: 'uncertain',
        dimensions: [],
        description: null,
        confidence: 0.3,
      };
      expect(validateJudgmentDraft(draft)).toBe(true);
    });

    it('rejects uncertain with a non-empty dimensions array (kept simple for this first Test 1 pass)', () => {
      const draft: SemanticRevisionJudgmentDraft = {
        verdict: 'uncertain',
        dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
        description: null,
        confidence: 0.3,
      };
      expect(validateJudgmentDraft(draft)).toBe(false);
    });

    it('accepts a change verdict with multiple distinct dimensions', () => {
      const draft: SemanticRevisionJudgmentDraft = {
        verdict: 'meaning_transformed',
        dimensions: [
          { dimension: 'certainty', direction: 'increased' },
          { dimension: 'commitment', direction: 'increased' },
        ],
        description: 'Certainty and commitment both increased.',
        confidence: 0.85,
      };
      expect(validateJudgmentDraft(draft)).toBe(true);
    });

    it('rejects a dimensions array with a duplicate dimension', () => {
      const draft: SemanticRevisionJudgmentDraft = {
        verdict: 'meaning_transformed',
        dimensions: [
          { dimension: 'certainty', direction: 'increased' },
          { dimension: 'certainty', direction: 'decreased' },
        ],
        description: 'x',
        confidence: 0.5,
      };
      expect(validateJudgmentDraft(draft)).toBe(false);
    });

    it('rejects an unrecognized dimension value', () => {
      const draft = {
        verdict: 'no_meaningful_change',
        dimensions: [{ dimension: 'mood', direction: 'increased' }],
        description: null,
        confidence: 0.5,
      } as unknown as SemanticRevisionJudgmentDraft;
      expect(validateJudgmentDraft(draft)).toBe(false);
    });

    it('rejects an unrecognized direction value', () => {
      const draft = {
        verdict: 'no_meaningful_change',
        dimensions: [{ dimension: 'certainty', direction: 'sideways' }],
        description: null,
        confidence: 0.5,
      } as unknown as SemanticRevisionJudgmentDraft;
      expect(validateJudgmentDraft(draft)).toBe(false);
    });

    it('rejects a non-array dimensions value', () => {
      const draft = {
        verdict: 'no_meaningful_change',
        dimensions: null,
        description: null,
        confidence: 0.5,
      } as unknown as SemanticRevisionJudgmentDraft;
      expect(validateJudgmentDraft(draft)).toBe(false);
    });
  });
});
