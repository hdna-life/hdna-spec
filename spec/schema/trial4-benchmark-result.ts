import type { SemanticChangeVerdict } from '../protocol/semantic-revision-judge';

/**
 * Which real system produced a given blinded label's response — the
 * ground truth the UI must not reveal until the operator has already
 * submitted a judgment (docs/decisions/0017, Operator Decision 6). Always
 * present in storage; `Trial4BenchmarkResult.revealed` is a display-only
 * gate in the UI, never a storage-layer redaction (same "not encrypted,
 * local-only" discipline already established for every other experimental
 * config/data store in this codebase — see e.g.
 * `semantic-revision-judge-config-store.ts`).
 */
export type Trial4BenchmarkRole = 'base' | 'trained' | 'deepseek';

export type Trial4BenchmarkLabel = 'A' | 'B' | 'C';

export type Trial4ResponseGrade = 'correct' | 'partial' | 'wrong';

/**
 * One blinded label's outcome: either a valid judgment (mirroring
 * `SemanticRevisionJudgmentDraft`) or a provider failure recorded as
 * `error` — a failed call is not silently omitted or repaired, it is shown
 * to the operator as its own gradeable (almost always `'wrong'`) outcome,
 * same "untrusted output, no repair" discipline as Trial 3.
 */
export interface Trial4BenchmarkResponse {
  role: Trial4BenchmarkRole;
  verdict: SemanticChangeVerdict | null;
  description: string | null;
  confidence: number | null;
  /** Set (and verdict/description/confidence left null) when this system's provider call failed instead of producing a judgment. */
  error: string | null;
  /** Human grading for this one label's response; null until the operator judges it. */
  grade: Trial4ResponseGrade | null;
}

/**
 * Trial 4's blind three-way comparison result for one
 * `Trial4BenchmarkCase` (docs/decisions/0017). `labelMapping`'s A/B/C
 * order is randomized per case at result-creation time
 * (`Trial4BenchmarkService`) and is NOT correlated with role across
 * different cases — the same role can land on a different label in every
 * case, which is what makes the comparison blind rather than merely
 * unlabeled.
 *
 * `bestResponse`/`note`/every `Trial4BenchmarkResponse.grade` are set
 * exactly once, at judgment submission (`judged` flips `false` -> `true`
 * atomically with them) — `revealed` toggling afterward must never mutate
 * any of those fields (docs/decisions/0017, Operator Decision 6: "The
 * recorded judgment must not change automatically after identities are
 * revealed").
 */
export interface Trial4BenchmarkResult {
  id: string;
  caseId: string;
  labelMapping: Record<Trial4BenchmarkLabel, Trial4BenchmarkResponse>;
  bestResponse: Trial4BenchmarkLabel | 'tie' | null;
  note: string;
  /** True once the operator has submitted Correct/Partial/Wrong + bestResponse for this case. */
  judged: boolean;
  /** UI-only "show model identities" toggle — never affects grade/bestResponse. */
  revealed: boolean;
  computedAt: string;
  judgedAt?: string;
}
