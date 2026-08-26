import type { EmbeddingVector } from '../schema/embedding';

/**
 * Contract for computing an embedding from text. Deliberately
 * execution-context-agnostic: `embed()` is async and has no dependency on
 * where or how the vector is produced, so a future real neural provider can
 * run behind an offscreen document / WebGPU executor (service workers are
 * unreliable hosts for long-lived WASM/model state) without any change to
 * this interface or to anything that consumes it (VectorIndexService, the
 * job processors, storage). Only the concrete provider implementation
 * changes; the vector/index/rebuild contract does not.
 *
 * The current implementation (HashingEmbeddingProvider) is an explicit,
 * documented non-semantic baseline — see docs/decisions/0009.
 */
export interface EmbeddingProvider {
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly dimensions: number;
  embed(text: string): Promise<EmbeddingVector>;
}
