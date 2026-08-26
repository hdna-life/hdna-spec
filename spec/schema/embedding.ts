/**
 * A derived vector representation of one piece of canonical evidence text.
 * Never canonical identity itself — fully rebuildable from the source text
 * at any time, per the design doc's "authorship_embedding != persona"
 * decision (docs/research/references.md).
 */
export interface EmbeddingVector {
  values: number[];
}

export interface Embedding {
  /** Id of the canonical evidence record this was computed from (e.g. a WritingSample or EditEvent id). */
  sourceId: string;
  /** Which evidence kind sourceId belongs to (e.g. "writing_sample", "edit_event") — lets retrieval resolve back to source text if needed. */
  sourceType: string;
  vector: EmbeddingVector;
  /** Identifies the embedding function/version that produced this vector — an index built by one extractor version must be rebuilt, not trusted, after a provider upgrade. */
  extractorId: string;
  extractorVersion: string;
  computedAt: string;
}
