import type { T2Dimension } from '../schema/t2-dimensions';

export interface TinyClassifierResult {
  scores: Partial<Record<T2Dimension, number>>;
  confidence: Partial<Record<T2Dimension, number>>;
}

/**
 * Contract for scoring T2 dimensions from text. Like EmbeddingProvider, this
 * is deliberately execution-context-agnostic — a future real trained
 * classifier can implement this without changing anything that consumes it.
 * The current implementation (HeuristicTinyClassifier) is an explicit,
 * documented heuristic baseline — see docs/decisions/0010.
 */
export interface TinyClassifier {
  readonly extractorId: string;
  readonly extractorVersion: string;
  classify(text: string): Promise<TinyClassifierResult>;
}
