import type { Trial4BenchmarkResult, Trial4BenchmarkRole } from '@spec/schema/trial4-benchmark-result';

export interface Trial4RoleStats {
  role: Trial4BenchmarkRole;
  judgedCount: number;
  correct: number;
  partial: number;
  wrong: number;
  /** Failed provider calls, counted separately from 'wrong' human grading (a distinct failure mode — see Trial4BenchmarkService's role-level error handling). */
  errors: number;
  /** correct / judgedCount, or 0 if judgedCount is 0 — never NaN. */
  correctRate: number;
}

export interface Trial4BenchmarkStats {
  base: Trial4RoleStats;
  trained: Trial4RoleStats;
  deepseek: Trial4RoleStats;
  /** trained.correctRate - base.correctRate — the single number Operator Decision 12's "first trained-vs-untrained result" question reduces to. Positive means trained improved on base. */
  trainedVsBaseImprovement: number;
  /** Count of judged results where bestResponse resolved to each role, plus ties — computed only from `judged` results. */
  winCounts: Record<Trial4BenchmarkRole, number>;
  tieCount: number;
  judgedResultCount: number;
  totalResultCount: number;
}

const ROLES: Trial4BenchmarkRole[] = ['base', 'trained', 'deepseek'];

function emptyRoleStats(role: Trial4BenchmarkRole): Trial4RoleStats {
  return { role, judgedCount: 0, correct: 0, partial: 0, wrong: 0, errors: 0, correctRate: 0 };
}

/**
 * Pure aggregation over persisted `Trial4BenchmarkResult`s — no storage
 * access, no model calls. Used by `Trial4BenchmarkPanel.svelte` to display
 * base/trained/DeepSeek performance, the trained-vs-base improvement
 * number, and blind win/preference rates (docs/decisions/0017's
 * benchmark-results requirement). Only `judged` results contribute to any
 * grade-based count — an in-flight, not-yet-graded result contributes to
 * neither role stats nor win counts, so a partially-worked-through
 * benchmark session never skews the numbers.
 */
export function computeTrial4BenchmarkStats(results: Trial4BenchmarkResult[]): Trial4BenchmarkStats {
  const stats: Record<Trial4BenchmarkRole, Trial4RoleStats> = {
    base: emptyRoleStats('base'),
    trained: emptyRoleStats('trained'),
    deepseek: emptyRoleStats('deepseek'),
  };
  const winCounts: Record<Trial4BenchmarkRole, number> = { base: 0, trained: 0, deepseek: 0 };
  let tieCount = 0;
  let judgedResultCount = 0;

  for (const result of results) {
    if (!result.judged) continue;
    judgedResultCount += 1;

    for (const role of ROLES) {
      const label = (Object.keys(result.labelMapping) as (keyof typeof result.labelMapping)[]).find(
        (candidateLabel) => result.labelMapping[candidateLabel].role === role,
      );
      if (!label) continue;
      const response = result.labelMapping[label];
      const roleStats = stats[role];
      if (response.error) {
        roleStats.errors += 1;
        continue;
      }
      if (response.grade === 'correct') roleStats.correct += 1;
      else if (response.grade === 'partial') roleStats.partial += 1;
      else if (response.grade === 'wrong') roleStats.wrong += 1;
      if (response.grade !== null) roleStats.judgedCount += 1;
    }

    if (result.bestResponse === 'tie') {
      tieCount += 1;
    } else if (result.bestResponse !== null) {
      const winningRole = result.labelMapping[result.bestResponse].role;
      winCounts[winningRole] += 1;
    }
  }

  for (const role of ROLES) {
    const roleStats = stats[role];
    roleStats.correctRate = roleStats.judgedCount > 0 ? roleStats.correct / roleStats.judgedCount : 0;
  }

  return {
    base: stats.base,
    trained: stats.trained,
    deepseek: stats.deepseek,
    trainedVsBaseImprovement: stats.trained.correctRate - stats.base.correctRate,
    winCounts,
    tieCount,
    judgedResultCount,
    totalResultCount: results.length,
  };
}
