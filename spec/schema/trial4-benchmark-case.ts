import type { BehaviorDimensionChange, RevisionInterventionKind, SemanticChangeVerdict } from '../protocol/semantic-revision-judge';
import type { Trial4CandidateLanguage } from './trial4-training-candidate';

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
 *
 * **Frozen ground truth (`expectedVerdict`/`expectedDimensions`), Test 1
 * addendum.** Both optional, both entirely absent from every current call
 * site that constructs a `SemanticRevisionJudgeInput` for a model
 * (`Trial4BenchmarkService.judgeWithRole` sends only
 * `kind`/`originalText`/`finalText`/`beforeContext`/`afterContext` — never
 * these two fields) — a model can never see its own answer key. Also
 * never shown to the operator by `Trial4BenchmarkPanel.svelte` before
 * blind grading is submitted, for the same reason the A/B/C role mapping
 * stays hidden until `revealed`. Present so a future, explicit scoring
 * pass can compute objective semantic-verdict/dimension-set accuracy
 * alongside the existing blind subjective comparison — computing that
 * score is deliberately NOT implemented in this addendum (see
 * docs/decisions/0017's "no dimension success threshold yet" note).
 */
export interface Trial4BenchmarkCase {
  id: string;
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  beforeContext: string;
  afterContext: string;
  /** Dataset balancing/reporting metadata only — never fed to the judge prompt. */
  language?: Trial4CandidateLanguage;
  /** Frozen ground truth — never sent to a model, never shown before blind grading. See this interface's docstring. */
  expectedVerdict?: SemanticChangeVerdict;
  /** Frozen ground truth — never sent to a model, never shown before blind grading. See this interface's docstring. */
  expectedDimensions?: BehaviorDimensionChange[];
}
