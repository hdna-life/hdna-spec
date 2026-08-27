import type { RevisionInterventionKind } from '../protocol/semantic-revision-judge';

/**
 * One held-out falsification-benchmark case for Trial 4's blind
 * three-way comparison (docs/decisions/0017, Operator Decision 7:
 * training and held-out falsification must remain separated). Shape is
 * identical to `SemanticRevisionJudgeInput` plus a stable `id` — a
 * benchmark case is exactly one narrow judgeable unit, the same contract
 * Trial 3's providers already implement, reused here rather than inventing
 * a second, incompatible benchmark input shape (docs/decisions/0017's
 * "reuse the existing Trial 3 quantitative evaluation" requirement).
 *
 * The real held-out corpus is operator-supplied (imported via
 * `Trial4BenchmarkPanel.svelte`'s file input) and must never be generated
 * by, or leak into, `training/phase5a/`'s candidate-generation pipeline —
 * see docs/decisions/0017's evaluation-integrity section. This schema
 * only describes the shape; it carries no data of its own, and no sample
 * fixture in this repository is the real benchmark.
 */
export interface Trial4BenchmarkCase {
  id: string;
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  beforeContext: string;
  afterContext: string;
}
