import { describe, expect, it } from 'vitest';
import {
  isEligibleForInterpretation,
  patternKey,
  toPatternCandidate,
  validateClaimDraft,
} from '../../src/persona/persona-interpreter';
import type { Pattern } from '@spec/schema/pattern';
import type { TraitBeliefClaimDraft } from '@spec/protocol/persona-interpreter';

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    dimension: 'formality',
    context: 'unscoped',
    value: 0.5,
    confidenceWeight: 3,
    sampleCount: 3,
    supportingRecordIds: ['a', 'b', 'c'],
    compilerId: 'deterministic-aggregate',
    compilerVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<TraitBeliefClaimDraft> = {}): TraitBeliefClaimDraft {
  return {
    claim: 'prioritizes implementation simplicity',
    context: 'unscoped',
    confidence: 0.6,
    supportingPatternKeys: ['formality:unscoped'],
    ...overrides,
  };
}

describe('patternKey', () => {
  it('matches PatternStore\'s dimension:context composite key', () => {
    expect(patternKey({ dimension: 'formality', context: 'unscoped' })).toBe('formality:unscoped');
  });
});

describe('toPatternCandidate', () => {
  it('drops supportingRecordIds/compilerId/compilerVersion/computedAt, keeping only aggregate stats', () => {
    expect(toPatternCandidate(pattern())).toEqual({
      dimension: 'formality',
      context: 'unscoped',
      value: 0.5,
      sampleCount: 3,
    });
  });
});

describe('isEligibleForInterpretation', () => {
  const policy = { minPatternCount: 2 };

  it('is ineligible below the threshold', () => {
    expect(isEligibleForInterpretation([pattern()], policy)).toBe(false);
  });

  it('is eligible at the threshold', () => {
    expect(isEligibleForInterpretation([pattern(), pattern({ dimension: 'directness' })], policy)).toBe(true);
  });

  it('is eligible above the threshold', () => {
    const patterns = [pattern(), pattern({ dimension: 'directness' }), pattern({ dimension: 'compressionRatio' })];
    expect(isEligibleForInterpretation(patterns, policy)).toBe(true);
  });
});

describe('validateClaimDraft', () => {
  const candidateKeys = new Set(['formality:unscoped', 'directness:unscoped']);

  it('accepts a well-formed draft citing real candidate keys', () => {
    expect(validateClaimDraft(draft(), candidateKeys)).toBe(true);
  });

  it('rejects confidence below 0', () => {
    expect(validateClaimDraft(draft({ confidence: -0.1 }), candidateKeys)).toBe(false);
  });

  it('rejects confidence above 1', () => {
    expect(validateClaimDraft(draft({ confidence: 1.1 }), candidateKeys)).toBe(false);
  });

  it('rejects an empty claim', () => {
    expect(validateClaimDraft(draft({ claim: '   ' }), candidateKeys)).toBe(false);
  });

  it('rejects a draft with no supporting patterns', () => {
    expect(validateClaimDraft(draft({ supportingPatternKeys: [] }), candidateKeys)).toBe(false);
  });

  it('rejects a hallucinated supporting key not in the candidate set', () => {
    expect(validateClaimDraft(draft({ supportingPatternKeys: ['madeUpDimension:unscoped'] }), candidateKeys)).toBe(
      false,
    );
  });
});
