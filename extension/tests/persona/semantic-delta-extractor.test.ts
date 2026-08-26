import { describe, expect, it } from 'vitest';
import { validateCandidateDraft } from '../../src/persona/semantic-delta-extractor';
import type { SemanticDeltaCandidateDraft } from '@spec/protocol/semantic-delta-extractor';

function draft(overrides: Partial<SemanticDeltaCandidateDraft> = {}): SemanticDeltaCandidateDraft {
  return {
    kind: 'behavioral_delta',
    observation: 'adds an explicit recommendation to validate the core hypothesis first',
    context: 'unscoped',
    confidence: 0.7,
    ...overrides,
  };
}

describe('validateCandidateDraft', () => {
  it('accepts a valid contrastive_preference draft with both preferred/rejected', () => {
    const d = draft({
      kind: 'contrastive_preference',
      preferred: 'validate the core hypothesis before expanding scope',
      rejected: 'additional development before validating demand',
    });
    expect(validateCandidateDraft(d)).toBe(true);
  });

  it('accepts a valid behavioral_delta draft with neither preferred nor rejected', () => {
    expect(validateCandidateDraft(draft())).toBe(true);
  });

  it('rejects confidence below 0', () => {
    expect(validateCandidateDraft(draft({ confidence: -0.1 }))).toBe(false);
  });

  it('rejects confidence above 1', () => {
    expect(validateCandidateDraft(draft({ confidence: 1.1 }))).toBe(false);
  });

  it('rejects an empty observation', () => {
    expect(validateCandidateDraft(draft({ observation: '   ' }))).toBe(false);
  });

  it('rejects an empty context', () => {
    expect(validateCandidateDraft(draft({ context: '' }))).toBe(false);
  });

  it('rejects a contrastive_preference draft missing preferred', () => {
    const d = draft({ kind: 'contrastive_preference', rejected: 'something' });
    expect(validateCandidateDraft(d)).toBe(false);
  });

  it('rejects a contrastive_preference draft missing rejected', () => {
    const d = draft({ kind: 'contrastive_preference', preferred: 'something' });
    expect(validateCandidateDraft(d)).toBe(false);
  });
});
