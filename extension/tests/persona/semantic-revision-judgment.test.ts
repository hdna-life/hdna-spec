import { describe, expect, it } from 'vitest';
import { validateJudgmentDraft } from '../../src/persona/semantic-revision-judgment';
import type { SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';

describe('validateJudgmentDraft', () => {
  it('accepts no_meaningful_change with description null', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'no_meaningful_change', description: null, confidence: 0.9 };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts uncertain with description null', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'uncertain', description: null, confidence: 0.4 };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts meaning_added with a non-blank description', () => {
    const draft: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_added',
      description: 'Added an explicit constraint.',
      confidence: 0.7,
    };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts meaning_removed with a non-blank description', () => {
    const draft: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_removed',
      description: 'Removed a hedge.',
      confidence: 0.7,
    };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('accepts meaning_transformed with a non-blank description', () => {
    const draft: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_transformed',
      description: 'Shifted from conditional to unconditional.',
      confidence: 0.7,
    };
    expect(validateJudgmentDraft(draft)).toBe(true);
  });

  it('rejects meaning_added with description null', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'meaning_added', description: null, confidence: 0.7 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects meaning_removed with a blank/whitespace-only description', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'meaning_removed', description: '   ', confidence: 0.7 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects meaning_transformed with an empty-string description', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'meaning_transformed', description: '', confidence: 0.7 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects an out-of-range confidence (> 1)', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'no_meaningful_change', description: null, confidence: 1.1 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects an out-of-range confidence (< 0)', () => {
    const draft: SemanticRevisionJudgmentDraft = { verdict: 'uncertain', description: null, confidence: -0.1 };
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects a non-numeric confidence', () => {
    const draft = { verdict: 'uncertain', description: null, confidence: 'high' } as unknown as SemanticRevisionJudgmentDraft;
    expect(validateJudgmentDraft(draft)).toBe(false);
  });

  it('rejects an unrecognized verdict', () => {
    const draft = { verdict: 'trait_inferred', description: 'x', confidence: 0.5 } as unknown as SemanticRevisionJudgmentDraft;
    expect(validateJudgmentDraft(draft)).toBe(false);
  });
});
