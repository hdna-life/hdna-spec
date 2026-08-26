import { describe, expect, it } from 'vitest';
import { computeEditMetrics, jaccardWordOverlap, levenshteinDistance } from '../../src/persona/edit-metrics';

describe('levenshteinDistance', () => {
  it('is 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('equals the length of the longer string when one is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('counts a single substitution as distance 1', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('counts a single insertion as distance 1', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('computes the classic kitten/sitting example', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('jaccardWordOverlap', () => {
  it('is 1 for identical word sets', () => {
    expect(jaccardWordOverlap('hello world', 'hello world')).toBe(1);
  });

  it('is 1 for two empty strings', () => {
    expect(jaccardWordOverlap('', '')).toBe(1);
  });

  it('is 0 for completely disjoint word sets', () => {
    expect(jaccardWordOverlap('foo bar', 'baz qux')).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    // {a,b,c} vs {b,c,d} -> intersection {b,c}=2, union {a,b,c,d}=4 -> 0.5
    expect(jaccardWordOverlap('a b c', 'b c d')).toBe(0.5);
  });

  it('is case-insensitive', () => {
    expect(jaccardWordOverlap('Hello World', 'hello world')).toBe(1);
  });
});

describe('computeEditMetrics', () => {
  it('computes all metrics deterministically for a known pair', () => {
    const metrics = computeEditMetrics(
      {
        id: 'evt-1',
        sourceText: 'cat sat.',
        finalText: 'cat sat down.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      () => '2026-01-02T00:00:00.000Z',
    );

    expect(metrics.editEventId).toBe('evt-1');
    expect(metrics.editDistance).toBe(levenshteinDistance('cat sat.', 'cat sat down.'));
    expect(metrics.compressionRatio).toBe('cat sat down.'.length / 'cat sat.'.length);
    expect(metrics.sentenceCountChange).toBe(0);
    expect(metrics.lexicalOverlap).toBe(jaccardWordOverlap('cat sat.', 'cat sat down.'));
    expect(metrics.computedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('treats an empty source text as compressionRatio 1', () => {
    const metrics = computeEditMetrics({
      id: 'evt-2',
      sourceText: '',
      finalText: 'anything',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(metrics.compressionRatio).toBe(1);
  });
});
