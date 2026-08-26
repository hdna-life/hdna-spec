import type { Embedding, EmbeddingVector } from '@spec/schema/embedding';

export interface ScoredEmbedding {
  embedding: Embedding;
  /** Cosine similarity, -1..1, higher = more similar. */
  score: number;
}

export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.values.length !== b.values.length) {
    throw new Error(`Embedding dimension mismatch: ${a.values.length} vs ${b.values.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.values.length; i += 1) {
    dot += a.values[i] * b.values[i];
    normA += a.values[i] ** 2;
    normB += b.values[i] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Pure, deterministic k-nearest-neighbor search: a full linear scan over the
 * given candidates, ranked by cosine similarity. Not an approximate-nearest-
 * neighbor index — adequate for the MVP's expected local dataset sizes;
 * swapping in a real ANN structure later doesn't change this function's
 * contract (candidates in, ranked matches out).
 */
export function queryNearest(query: EmbeddingVector, candidates: Embedding[], k: number): ScoredEmbedding[] {
  return candidates
    .map((embedding) => ({ embedding, score: cosineSimilarity(query, embedding.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
