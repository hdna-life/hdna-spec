import { describe, expect, it } from 'vitest';
import { applyTraitScore } from '../../src/persona/t2-profile';
import type { TraitScoreRecord } from '@spec/schema/trait-score';

function record(overrides: Partial<TraitScoreRecord> = {}): TraitScoreRecord {
  return {
    sourceId: 'evt',
    sourceType: 'edit_event',
    scores: {},
    confidence: {},
    extractorId: 'heuristic-lexical',
    extractorVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('applyTraitScore', () => {
  it('initializes a dimension aggregate from the first observation', () => {
    const profile = applyTraitScore(
      undefined,
      record({ scores: { formality: 0.8 }, confidence: { formality: 1 } }),
      () => '2026-01-01T00:00:00.000Z',
    );
    expect(profile.formality).toEqual({ weightedMeanScore: 0.8, totalConfidenceWeight: 1, sampleCount: 1 });
    expect(profile.directness).toBeUndefined();
  });

  it('folds a second observation into a confidence-weighted running mean', () => {
    const first = applyTraitScore(undefined, record({ scores: { formality: 1.0 }, confidence: { formality: 1 } }));
    const second = applyTraitScore(first, record({ scores: { formality: 0.0 }, confidence: { formality: 1 } }));

    // Equal confidence weights -> simple average: (1.0 + 0.0) / 2 = 0.5
    expect(second.formality?.weightedMeanScore).toBeCloseTo(0.5, 10);
    expect(second.formality?.sampleCount).toBe(2);
  });

  it('weights a high-confidence observation more heavily than a low-confidence one', () => {
    const first = applyTraitScore(undefined, record({ scores: { formality: 1.0 }, confidence: { formality: 1.0 } }));
    const second = applyTraitScore(first, record({ scores: { formality: 0.0 }, confidence: { formality: 0.1 } }));

    // (1.0*1.0 + 0.0*0.1) / (1.0 + 0.1) = 1.0/1.1
    expect(second.formality?.weightedMeanScore).toBeCloseTo(1.0 / 1.1, 10);
  });

  it('updates multiple dimensions independently from one record', () => {
    const profile = applyTraitScore(
      undefined,
      record({ scores: { formality: 0.9, directness: 0.2 }, confidence: { formality: 1, directness: 1 } }),
    );
    expect(profile.formality?.weightedMeanScore).toBe(0.9);
    expect(profile.directness?.weightedMeanScore).toBe(0.2);
  });

  it('leaves a dimension untouched when the record does not include it', () => {
    const withFormality = applyTraitScore(
      undefined,
      record({ scores: { formality: 0.7 }, confidence: { formality: 1 } }),
    );
    const stillOnlyFormality = applyTraitScore(
      withFormality,
      record({ scores: {}, confidence: {} }),
    );
    expect(stillOnlyFormality.formality).toEqual(withFormality.formality);
    expect(stillOnlyFormality.directness).toBeUndefined();
  });

  it('uses the injected clock for updatedAt', () => {
    const profile = applyTraitScore(undefined, record(), () => '2026-06-01T00:00:00.000Z');
    expect(profile.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});
