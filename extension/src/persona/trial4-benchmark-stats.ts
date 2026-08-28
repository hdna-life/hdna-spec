import type { BehaviorDimensionChange } from '@spec/protocol/semantic-revision-judge';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type { Trial4BenchmarkResponse, Trial4BenchmarkResult, Trial4BenchmarkRole } from '@spec/schema/trial4-benchmark-result';

export interface Trial4RoleStats {
  role: Trial4BenchmarkRole;

  // --- Legacy Correct/Partial/Wrong grade, superseded by acceptability
  // below (docs/decisions/0017's "acceptability gate + ranking" addendum)
  // — kept computed only so historical results graded before the
  // addendum still show something; always 0 for results judged after it,
  // since `grade` is never set by the new judging flow.
  judgedCount: number;
  correct: number;
  partial: number;
  wrong: number;
  /** correct / judgedCount, or 0 if judgedCount is 0 — never NaN. */
  correctRate: number;

  // --- Primary Test 1 signal: acceptability gate + ranking ---
  /** Number of this role's responses where the operator recorded humanAcceptable (true or false) — the denominator for every rate below. */
  acceptabilityJudgedCount: number;
  acceptableCount: number;
  unacceptableCount: number;
  /** acceptableCount / acceptabilityJudgedCount, or 0 if the denominator is 0 — never NaN. */
  acceptableRate: number;
  /** unacceptableCount / acceptabilityJudgedCount, or 0 if the denominator is 0 — never NaN. */
  unacceptableRate: number;
  /** Count of this role's responses ranked #1 among their case's acceptable responses. */
  rank1Count: number;
  /** rank1Count / acceptabilityJudgedCount, or 0 if the denominator is 0 — never NaN. */
  rank1Rate: number;
  /** Mean humanRank across this role's acceptable, ranked responses; null if it was never acceptable anywhere. */
  meanRankAmongAcceptable: number | null;

  /** Failed provider calls, counted separately from acceptability (a distinct failure mode — see Trial4BenchmarkService's role-level error handling). */
  errors: number;

  // --- Objective accuracy against frozen, LOCKED held-out ground truth
  // (Trial4BenchmarkCase.humanVerdict/humanDimensions, only counted when
  // groundTruthLocked === true), only ever computed from a case's OWN
  // frozen fields — never from another system's response, and never shown
  // to the operator before grading. Both null when no matching locked
  // case in this run exists — "no ground truth available yet," not "0%
  // accuracy." This is Test 1's PRIMARY metric (5-way semantic verdict
  // exact accuracy).
  /** Fraction of locked-ground-truth cases where this role's verdict exactly matched humanVerdict. Null if verdictAccuracyCount is 0. */
  verdictAccuracy: number | null;
  /** Denominator for verdictAccuracy: locked-ground-truth cases with a non-error response from this role. */
  verdictAccuracyCount: number;
  /** Fraction of locked-ground-truth cases where this role's dimension SET (dimension+direction pairs, order-independent) exactly matched humanDimensions. Null if dimensionGroundTruthCount is 0. */
  dimensionExactSetAccuracy: number | null;
  /** Micro-averaged F1 over (dimension, direction) pairs across every locked-ground-truth case. Null if dimensionGroundTruthCount is 0. */
  dimensionMicroF1: number | null;
  /** Denominator for both dimension metrics: locked-ground-truth cases with a non-error response from this role. */
  dimensionGroundTruthCount: number;
}

export interface Trial4BenchmarkStats {
  base: Trial4RoleStats;
  trained: Trial4RoleStats;
  deepseek: Trial4RoleStats;
  /**
   * trained.acceptableRate - base.acceptableRate — Test 1's central
   * falsifiable question ("did specialization materially improve the same
   * 0.6B model over base"), reduced to a single number. Positive means
   * trained improved on base. Deliberately NOT compared against DeepSeek —
   * DeepSeek is a frontier reference/ceiling, not a success condition
   * (docs/decisions/0017's "acceptability gate + ranking" addendum).
   */
  trainedVsBaseImprovement: number;
  /** Count of judged results where bestResponse (rank-1) resolved to each role — computed only from `judged` results. */
  winCounts: Record<Trial4BenchmarkRole, number>;
  /** Judged results where NO response was acceptable — itself a meaningful, explicitly-tracked outcome, not an error. */
  noAcceptableResponseCount: number;
  judgedResultCount: number;
  totalResultCount: number;
}

const ROLES: Trial4BenchmarkRole[] = ['base', 'trained', 'deepseek'];

function emptyRoleStats(role: Trial4BenchmarkRole): Trial4RoleStats {
  return {
    role,
    judgedCount: 0,
    correct: 0,
    partial: 0,
    wrong: 0,
    correctRate: 0,
    acceptabilityJudgedCount: 0,
    acceptableCount: 0,
    unacceptableCount: 0,
    acceptableRate: 0,
    unacceptableRate: 0,
    rank1Count: 0,
    rank1Rate: 0,
    meanRankAmongAcceptable: null,
    errors: 0,
    verdictAccuracy: null,
    verdictAccuracyCount: 0,
    dimensionExactSetAccuracy: null,
    dimensionMicroF1: null,
    dimensionGroundTruthCount: 0,
  };
}

function dimensionKey(change: BehaviorDimensionChange): string {
  return `${change.dimension}:${change.direction}`;
}

/** Order-independent set equality over (dimension, direction) pairs. */
function dimensionSetsEqual(a: BehaviorDimensionChange[], b: BehaviorDimensionChange[]): boolean {
  if (a.length !== b.length) return false;
  const aKeys = new Set(a.map(dimensionKey));
  const bKeys = new Set(b.map(dimensionKey));
  if (aKeys.size !== bKeys.size) return false;
  for (const key of aKeys) if (!bKeys.has(key)) return false;
  return true;
}

interface RoleAccumulator {
  rankSum: number;
  rankCount: number;
  verdictCorrect: number;
  dimensionExactMatches: number;
  dimensionTruePositives: number;
  dimensionFalsePositives: number;
  dimensionFalseNegatives: number;
}

function emptyAccumulator(): RoleAccumulator {
  return {
    rankSum: 0,
    rankCount: 0,
    verdictCorrect: 0,
    dimensionExactMatches: 0,
    dimensionTruePositives: 0,
    dimensionFalsePositives: 0,
    dimensionFalseNegatives: 0,
  };
}

/**
 * Pure aggregation over persisted `Trial4BenchmarkResult`s (+ the
 * corresponding `Trial4BenchmarkCase`s, for frozen-ground-truth accuracy —
 * optional, defaults to `[]` so existing call sites that only have results
 * keep working; ground-truth metrics simply stay `null` in that case). No
 * storage access, no model calls. Used by `Trial4BenchmarkPanel.svelte`/
 * `DashboardOverview.svelte` to display base/trained/DeepSeek performance,
 * the trained-vs-base improvement number, and blind acceptability/ranking
 * results (docs/decisions/0017's "acceptability gate + ranking" addendum).
 * Only `judged` results contribute to any count — an in-flight,
 * not-yet-graded result contributes to nothing, so a partially-worked-
 * through benchmark session never skews the numbers.
 */
export function computeTrial4BenchmarkStats(
  results: Trial4BenchmarkResult[],
  cases: Trial4BenchmarkCase[] = [],
): Trial4BenchmarkStats {
  const casesById = new Map(cases.map((c) => [c.id, c]));
  const stats: Record<Trial4BenchmarkRole, Trial4RoleStats> = {
    base: emptyRoleStats('base'),
    trained: emptyRoleStats('trained'),
    deepseek: emptyRoleStats('deepseek'),
  };
  const accumulators: Record<Trial4BenchmarkRole, RoleAccumulator> = {
    base: emptyAccumulator(),
    trained: emptyAccumulator(),
    deepseek: emptyAccumulator(),
  };
  const winCounts: Record<Trial4BenchmarkRole, number> = { base: 0, trained: 0, deepseek: 0 };
  let noAcceptableResponseCount = 0;
  let judgedResultCount = 0;

  for (const result of results) {
    if (!result.judged) continue;
    judgedResultCount += 1;
    const benchmarkCase = casesById.get(result.caseId);

    let anyAcceptableThisResult = false;

    for (const role of ROLES) {
      const label = (Object.keys(result.labelMapping) as (keyof typeof result.labelMapping)[]).find(
        (candidateLabel) => result.labelMapping[candidateLabel].role === role,
      );
      if (!label) continue;
      const response: Trial4BenchmarkResponse = result.labelMapping[label];
      const roleStats = stats[role];
      const acc = accumulators[role];

      if (response.error) {
        roleStats.errors += 1;
        continue;
      }

      // Legacy grade (superseded — see Trial4RoleStats docstring).
      if (response.grade === 'correct') roleStats.correct += 1;
      else if (response.grade === 'partial') roleStats.partial += 1;
      else if (response.grade === 'wrong') roleStats.wrong += 1;
      if (response.grade !== null) roleStats.judgedCount += 1;

      // Primary acceptability + rank signal.
      if (response.humanAcceptable !== null) {
        roleStats.acceptabilityJudgedCount += 1;
        if (response.humanAcceptable) {
          roleStats.acceptableCount += 1;
          anyAcceptableThisResult = true;
          if (response.humanRank !== null) {
            acc.rankSum += response.humanRank;
            acc.rankCount += 1;
            if (response.humanRank === 1) roleStats.rank1Count += 1;
          }
        } else {
          roleStats.unacceptableCount += 1;
        }
      }

      // Objective accuracy against frozen, LOCKED ground truth only — an
      // in-progress/unlocked draft on the case must never be scored
      // against, matching the same "not committed, doesn't count" rule
      // applied to humanAcceptable/humanRank above.
      if (benchmarkCase?.groundTruthLocked) {
        roleStats.verdictAccuracyCount += 1;
        if (response.verdict === benchmarkCase.humanVerdict) acc.verdictCorrect += 1;

        roleStats.dimensionGroundTruthCount += 1;
        if (dimensionSetsEqual(response.dimensions, benchmarkCase.humanDimensions)) acc.dimensionExactMatches += 1;

        const expectedKeys = new Set(benchmarkCase.humanDimensions.map(dimensionKey));
        const predictedKeys = new Set(response.dimensions.map(dimensionKey));
        for (const key of predictedKeys) {
          if (expectedKeys.has(key)) acc.dimensionTruePositives += 1;
          else acc.dimensionFalsePositives += 1;
        }
        for (const key of expectedKeys) {
          if (!predictedKeys.has(key)) acc.dimensionFalseNegatives += 1;
        }
      }
    }

    if (!anyAcceptableThisResult) noAcceptableResponseCount += 1;

    if (result.bestResponse !== null) {
      const winningRole = result.labelMapping[result.bestResponse].role;
      winCounts[winningRole] += 1;
    }
  }

  for (const role of ROLES) {
    const roleStats = stats[role];
    const acc = accumulators[role];
    roleStats.correctRate = roleStats.judgedCount > 0 ? roleStats.correct / roleStats.judgedCount : 0;
    roleStats.acceptableRate =
      roleStats.acceptabilityJudgedCount > 0 ? roleStats.acceptableCount / roleStats.acceptabilityJudgedCount : 0;
    roleStats.unacceptableRate =
      roleStats.acceptabilityJudgedCount > 0 ? roleStats.unacceptableCount / roleStats.acceptabilityJudgedCount : 0;
    roleStats.rank1Rate =
      roleStats.acceptabilityJudgedCount > 0 ? roleStats.rank1Count / roleStats.acceptabilityJudgedCount : 0;
    roleStats.meanRankAmongAcceptable = acc.rankCount > 0 ? acc.rankSum / acc.rankCount : null;
    roleStats.verdictAccuracy = roleStats.verdictAccuracyCount > 0 ? acc.verdictCorrect / roleStats.verdictAccuracyCount : null;
    roleStats.dimensionExactSetAccuracy =
      roleStats.dimensionGroundTruthCount > 0 ? acc.dimensionExactMatches / roleStats.dimensionGroundTruthCount : null;
    const dimensionDenominator = 2 * acc.dimensionTruePositives + acc.dimensionFalsePositives + acc.dimensionFalseNegatives;
    roleStats.dimensionMicroF1 =
      roleStats.dimensionGroundTruthCount > 0 && dimensionDenominator > 0
        ? (2 * acc.dimensionTruePositives) / dimensionDenominator
        : roleStats.dimensionGroundTruthCount > 0
          ? 1 // no expected and no predicted dimensions anywhere — vacuously perfect precision/recall
          : null;
  }

  return {
    base: stats.base,
    trained: stats.trained,
    deepseek: stats.deepseek,
    trainedVsBaseImprovement: stats.trained.acceptableRate - stats.base.acceptableRate,
    winCounts,
    noAcceptableResponseCount,
    judgedResultCount,
    totalResultCount: results.length,
  };
}
