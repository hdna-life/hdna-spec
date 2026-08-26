import { describe, expect, it } from 'vitest';
import { applyEditMetrics } from '../../src/persona/edit-profile';
import type { EditMetrics } from '@spec/schema/edit-metrics';

function metrics(overrides: Partial<EditMetrics> = {}): EditMetrics {
  return {
    editEventId: 'evt',
    editDistance: 0,
    compressionRatio: 0,
    sentenceCountChange: 0,
    lexicalOverlap: 0,
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('applyEditMetrics', () => {
  it('initializes the profile from the first observation', () => {
    const profile = applyEditMetrics(
      undefined,
      metrics({ editDistance: 4, compressionRatio: 1.2, lexicalOverlap: 0.8 }),
      () => '2026-01-01T00:00:00.000Z',
    );
    expect(profile).toEqual({
      sampleCount: 1,
      meanEditDistance: 4,
      meanCompressionRatio: 1.2,
      meanLexicalOverlap: 0.8,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('folds a second observation into a running mean without rescanning history', () => {
    const first = applyEditMetrics(undefined, metrics({ editDistance: 2, compressionRatio: 1.0, lexicalOverlap: 0.5 }));
    const second = applyEditMetrics(first, metrics({ editDistance: 6, compressionRatio: 2.0, lexicalOverlap: 1.0 }));

    expect(second.sampleCount).toBe(2);
    expect(second.meanEditDistance).toBe(4); // (2 + 6) / 2
    expect(second.meanCompressionRatio).toBe(1.5); // (1.0 + 2.0) / 2
    expect(second.meanLexicalOverlap).toBe(0.75); // (0.5 + 1.0) / 2
  });

  it('matches a direct arithmetic mean across many observations', () => {
    const values = [1, 3, 5, 7, 9];
    let profile: ReturnType<typeof applyEditMetrics> | undefined;
    for (const v of values) {
      profile = applyEditMetrics(profile, metrics({ editDistance: v }));
    }
    const expectedMean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(profile!.meanEditDistance).toBeCloseTo(expectedMean, 10);
    expect(profile!.sampleCount).toBe(values.length);
  });
});
