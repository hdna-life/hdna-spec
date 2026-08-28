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
 * **Frozen ground truth + lock (`humanVerdict`/`humanDimensions`/
 * `groundTruthLocked`), Test 1 evaluation-stage addendum
 * (docs/decisions/0017).** An imported case starts with no ground truth
 * (`humanVerdict: null`, `humanDimensions: []`, `groundTruthLocked:
 * false`) — the operator enters the semantic verdict and observable-
 * behavior dimensions in the Dashboard's Benchmark page (the SAME v3
 * dimension-selection contract Training Review already uses) and then
 * explicitly locks the case. **Once `groundTruthLocked` is `true`, the
 * normal UI path can no longer change `humanVerdict`/`humanDimensions`**
 * (`Trial4BenchmarkService.lockGroundTruth` throws if called again on an
 * already-locked case) — this is what makes the ground truth a genuine
 * held-out answer key rather than something that could drift after the
 * fact. `Trial4BenchmarkService.runNextCase` will not run any model
 * against a case until it is locked — models must never see, and the
 * operator must never grade against, an unlocked/in-progress ground
 * truth. Never sent to a model (`Trial4BenchmarkService.judgeWithRole`
 * sends only `kind`/`originalText`/`finalText`/`beforeContext`/
 * `afterContext`) and never shown to the operator during blind grading,
 * for the same reason the A/B/C role mapping stays hidden until
 * `revealed`. Used by `computeTrial4BenchmarkStats` to compute objective
 * semantic-verdict-exact-accuracy and dimension exact-set/micro-F1
 * alongside the existing blind subjective acceptability/ranking
 * evaluation — Test 1's primary metric.
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
  /** Frozen ground truth verdict. `null` until the operator locks this case. Never sent to a model, never shown before blind grading. See this interface's docstring. */
  humanVerdict: SemanticChangeVerdict | null;
  /** Frozen ground truth dimensions. `[]` until locked (and may legitimately remain `[]` after locking, same as Training Review's `humanDimensions`). Never sent to a model, never shown before blind grading. */
  humanDimensions: BehaviorDimensionChange[];
  /** Once `true`, `humanVerdict`/`humanDimensions` are frozen — the normal UI/service path cannot change them again, and only a locked case is eligible for `runNextCase`. */
  groundTruthLocked: boolean;
  /** Set exactly once, at lock time. */
  groundTruthLockedAt?: string;
}
