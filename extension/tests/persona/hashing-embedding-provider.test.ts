import { describe, expect, it } from 'vitest';
import { HashingEmbeddingProvider } from '../../src/persona/hashing-embedding-provider';
import { cosineSimilarity } from '../../src/persona/vector-index';

describe('HashingEmbeddingProvider', () => {
  const provider = new HashingEmbeddingProvider();

  it('is deterministic: the same text always produces the same vector', async () => {
    const a = await provider.embed('the quick brown fox');
    const b = await provider.embed('the quick brown fox');
    expect(a).toEqual(b);
  });

  it('produces a vector with the declared dimensionality', async () => {
    const vector = await provider.embed('hello world');
    expect(vector.values).toHaveLength(provider.dimensions);
  });

  it('L2-normalizes non-empty text to unit length', async () => {
    const vector = await provider.embed('some reasonably long piece of text here');
    const norm = Math.sqrt(vector.values.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('handles empty text without throwing, returning a zero vector', async () => {
    const vector = await provider.embed('');
    expect(vector.values).toHaveLength(provider.dimensions);
    expect(vector.values.every((v) => v === 0)).toBe(true);
  });

  it('is case-insensitive', async () => {
    const a = await provider.embed('Hello World');
    const b = await provider.embed('hello world');
    expect(a).toEqual(b);
  });

  it('scores near-duplicate text higher than unrelated text (self-consistency, not semantic claim)', async () => {
    const base = await provider.embed('the quick brown fox jumps over the lazy dog');
    const nearDuplicate = await provider.embed('the quick brown fox jumps over the lazy cat');
    const unrelated = await provider.embed('quantum mechanics describes subatomic particle behavior');

    const nearScore = cosineSimilarity(base, nearDuplicate);
    const farScore = cosineSimilarity(base, unrelated);
    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('exposes stable extractor identity metadata', () => {
    expect(provider.extractorId).toBe('hashing-ngram');
    expect(provider.extractorVersion).toBe('1.0.0');
  });
});
