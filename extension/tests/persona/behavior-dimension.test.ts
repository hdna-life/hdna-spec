import { describe, expect, it } from 'vitest';
import { BEHAVIOR_DIMENSIONS, BEHAVIOR_DIRECTIONS, isValidDimensionsArray } from '../../src/persona/behavior-dimension';

describe('BEHAVIOR_DIMENSIONS / BEHAVIOR_DIRECTIONS', () => {
  it('has exactly the 15 dimensions from the Test 1 taxonomy', () => {
    expect(BEHAVIOR_DIMENSIONS).toHaveLength(15);
    expect(BEHAVIOR_DIMENSIONS).toEqual([
      'expressed_affect_valence',
      'expressed_affect_intensity',
      'directness',
      'politeness',
      'formality',
      'certainty',
      'evidentiality',
      'commitment',
      'directive_force',
      'conditionality',
      'scope',
      'specificity',
      'rationale',
      'factual_content',
      'action_or_decision',
    ]);
  });

  it('every dimension name is expressed_*/observable-textual-stance framed, never emotion/mood/psychology terminology', () => {
    for (const dimension of BEHAVIOR_DIMENSIONS) {
      expect(dimension).not.toMatch(/\bemotion\b/i);
      expect(dimension).not.toMatch(/\bmood\b/i);
      expect(dimension).not.toMatch(/psycholog/i);
    }
  });

  it('has exactly the 9 direction values from the Test 1 taxonomy', () => {
    expect(BEHAVIOR_DIRECTIONS).toEqual([
      'increased',
      'decreased',
      'more_positive',
      'more_negative',
      'added',
      'removed',
      'narrowed',
      'expanded',
      'changed',
    ]);
  });
});

describe('isValidDimensionsArray', () => {
  it('accepts an empty array', () => {
    expect(isValidDimensionsArray([])).toBe(true);
  });

  it('accepts a single well-formed dimension change', () => {
    expect(isValidDimensionsArray([{ dimension: 'certainty', direction: 'decreased' }])).toBe(true);
  });

  it('accepts multiple distinct dimension changes', () => {
    expect(
      isValidDimensionsArray([
        { dimension: 'certainty', direction: 'increased' },
        { dimension: 'commitment', direction: 'increased' },
      ]),
    ).toBe(true);
  });

  it('accepts every documented sensible dimension/direction pairing', () => {
    const pairs: [string, string][] = [
      ['expressed_affect_intensity', 'increased'],
      ['expressed_affect_intensity', 'decreased'],
      ['expressed_affect_valence', 'more_positive'],
      ['expressed_affect_valence', 'more_negative'],
      ['directness', 'increased'],
      ['directness', 'decreased'],
      ['politeness', 'increased'],
      ['politeness', 'decreased'],
      ['formality', 'increased'],
      ['formality', 'decreased'],
      ['certainty', 'increased'],
      ['certainty', 'decreased'],
      ['evidentiality', 'changed'],
      ['commitment', 'increased'],
      ['commitment', 'decreased'],
      ['directive_force', 'increased'],
      ['directive_force', 'decreased'],
      ['conditionality', 'added'],
      ['conditionality', 'removed'],
      ['scope', 'narrowed'],
      ['scope', 'expanded'],
      ['specificity', 'increased'],
      ['specificity', 'decreased'],
      ['rationale', 'added'],
      ['rationale', 'removed'],
      ['factual_content', 'changed'],
      ['action_or_decision', 'changed'],
    ];
    for (const [dimension, direction] of pairs) {
      expect(isValidDimensionsArray([{ dimension, direction }])).toBe(true);
    }
  });

  it('rejects a duplicate dimension within the array', () => {
    expect(
      isValidDimensionsArray([
        { dimension: 'certainty', direction: 'increased' },
        { dimension: 'certainty', direction: 'decreased' },
      ]),
    ).toBe(false);
  });

  it('rejects an unrecognized dimension value', () => {
    expect(isValidDimensionsArray([{ dimension: 'mood', direction: 'increased' }])).toBe(false);
  });

  it('rejects an unrecognized direction value', () => {
    expect(isValidDimensionsArray([{ dimension: 'certainty', direction: 'sideways' }])).toBe(false);
  });

  it('rejects a non-array value', () => {
    expect(isValidDimensionsArray(null)).toBe(false);
    expect(isValidDimensionsArray(undefined)).toBe(false);
    expect(isValidDimensionsArray('not an array')).toBe(false);
    expect(isValidDimensionsArray({})).toBe(false);
  });

  it('rejects an array element missing the dimension field', () => {
    expect(isValidDimensionsArray([{ direction: 'increased' }])).toBe(false);
  });

  it('rejects an array element missing the direction field', () => {
    expect(isValidDimensionsArray([{ dimension: 'certainty' }])).toBe(false);
  });

  it('rejects an array element that is not an object', () => {
    expect(isValidDimensionsArray(['certainty'])).toBe(false);
    expect(isValidDimensionsArray([null])).toBe(false);
  });
});
