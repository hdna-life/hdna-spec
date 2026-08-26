import type { EmbeddingProvider } from '@spec/protocol/embedding-provider';
import type { EmbeddingVector } from '@spec/schema/embedding';

const DIMENSIONS = 128;
const NGRAM_SIZE = 3;

/** Deterministic 32-bit FNV-1a hash. No external dependency, stable across runs/platforms. */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function charNgrams(text: string, n: number): string[] {
  const normalized = text.toLowerCase();
  if (normalized.length === 0) return [];
  if (normalized.length <= n) return [normalized];
  const grams: string[] = [];
  for (let i = 0; i <= normalized.length - n; i += 1) {
    grams.push(normalized.slice(i, i + n));
  }
  return grams;
}

/**
 * Deterministic, dependency-free embedding baseline: character n-grams
 * hashed into a fixed-size vector (the standard "hashing trick"), L2
 * normalized. No model download, no WASM, no bundle-size cost, fully
 * unit-testable as a pure function.
 *
 * This is explicitly NOT a semantic embedding — it captures lexical/
 * character-level overlap, not meaning. It's a temporary baseline behind the
 * EmbeddingProvider contract; see docs/decisions/0009 for the tradeoff and
 * what a future real neural provider would need to change (nothing outside
 * this file).
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly extractorId = 'hashing-ngram';
  readonly extractorVersion = '1.0.0';
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<EmbeddingVector> {
    const vector = new Array(this.dimensions).fill(0);
    for (const gram of charNgrams(text, NGRAM_SIZE)) {
      const h = fnv1aHash(gram);
      const bucket = h % this.dimensions;
      const sign = (h & 1) === 0 ? 1 : -1; // reuses the same hash as a sign bit — standard hashing-trick bias reduction
      vector[bucket] += sign;
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    const values = norm === 0 ? vector : vector.map((v) => v / norm);
    return { values };
  }
}
