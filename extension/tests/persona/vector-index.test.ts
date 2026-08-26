import { describe, expect, it } from 'vitest';
import { cosineSimilarity, queryNearest } from '../../src/persona/vector-index';
import type { Embedding } from '@spec/schema/embedding';

function embedding(id: string, values: number[]): Embedding {
  return {
    sourceId: id,
    sourceType: 'test',
    vector: { values },
    extractorId: 'test-extractor',
    extractorVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity({ values: [1, 0, 0] }, { values: [1, 0, 0] })).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity({ values: [1, 0] }, { values: [0, 1] })).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity({ values: [1, 0] }, { values: [-1, 0] })).toBeCloseTo(-1, 10);
  });

  it('is 0 when either vector is all zeros', () => {
    expect(cosineSimilarity({ values: [0, 0] }, { values: [1, 1] })).toBe(0);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity({ values: [1, 0] }, { values: [1, 0, 0] })).toThrow();
  });
});

describe('queryNearest', () => {
  it('ranks candidates by descending cosine similarity', () => {
    const candidates = [
      embedding('far', [-1, 0]),
      embedding('near', [0.9, 0.1]),
      embedding('exact', [1, 0]),
    ];
    const results = queryNearest({ values: [1, 0] }, candidates, 3);
    expect(results.map((r) => r.embedding.sourceId)).toEqual(['exact', 'near', 'far']);
  });

  it('limits results to k', () => {
    const candidates = [embedding('a', [1, 0]), embedding('b', [1, 0]), embedding('c', [1, 0])];
    const results = queryNearest({ values: [1, 0] }, candidates, 2);
    expect(results).toHaveLength(2);
  });

  it('returns an empty array for no candidates', () => {
    expect(queryNearest({ values: [1, 0] }, [], 5)).toEqual([]);
  });
});
