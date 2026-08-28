import type { BehaviorDimensionChange, SemanticChangeVerdict } from '../protocol/semantic-revision-judge';

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

/**
 * Legacy per-response grade. **Superseded by `humanAcceptable`/`humanRank`
 * below** (docs/decisions/0017's "acceptability gate + ranking" addendum)
 * — no longer collected by `Trial4BenchmarkPanel.svelte`'s judging form.
 * Kept on the schema (rather than deleted) only so previously-stored
 * results remain valid to read; new results always leave this `null`.
 */
export type Trial4ResponseGrade = 'correct' | 'partial' | 'wrong';

/**
 * A response's rank among the ACCEPTABLE responses for its case, 1 = best.
 * Only ever set on a response with `humanAcceptable: true` — an
 * unacceptable response's rank is always `null` (enforced by
 * `Trial4BenchmarkService.submitJudgment`, not just a UI convention).
 */
export type Trial4BenchmarkRank = 1 | 2 | 3;

/**
 * One blinded label's outcome: either a valid judgment (mirroring
 * `SemanticRevisionJudgmentDraft`) or a provider failure recorded as
 * `error` — a failed call is not silently omitted or repaired, it is shown
 * to the operator as its own gradeable (almost always unacceptable)
 * outcome, same "untrusted output, no repair" discipline as Trial 3.
 */
export interface Trial4BenchmarkResponse {
  role: Trial4BenchmarkRole;
  verdict: SemanticChangeVerdict | null;
  /**
   * The system's observable-behavior dimensions (Test 1 addendum,
   * docs/decisions/0017). Empty array on a successful judgment with no
   * asserted dimensions; empty array (not null) on a failed call too —
   * `error` is what signals failure, not this field's emptiness.
   */
  dimensions: BehaviorDimensionChange[];
  description: string | null;
  confidence: number | null;
  /** Set (and verdict/dimensions/description/confidence left null/empty) when this system's provider call failed instead of producing a judgment. */
  error: string | null;
  /** Legacy — see this type's docstring. Always null on results judged after the acceptability-gate addendum. */
  grade: Trial4ResponseGrade | null;
  /**
   * **Primary judgment signal, docs/decisions/0017's "acceptability gate +
   * ranking" addendum.** Null until the operator judges this response.
   * Test 1's central question is not "does trained Qwen beat DeepSeek" —
   * it is "is trained Qwen's output acceptable/useful often enough to
   * serve as a local judge, and did it improve over base." Acceptability
   * is judged independently per response, before any ranking happens.
   */
  humanAcceptable: boolean | null;
  /**
   * Set ONLY when `humanAcceptable` is `true` — an unacceptable response
   * is never ranked (enforced by `Trial4BenchmarkService.submitJudgment`).
   * 1 = best among this case's acceptable responses; ranks are dense
   * (1, 2, ... up to however many responses were acceptable) and unique
   * within one result. If zero responses were acceptable, every
   * `humanRank` in this result is `null` — a case can have no acceptable
   * response at all, and that is itself the recorded, meaningful outcome
   * (not an error state).
   */
  humanRank: Trial4BenchmarkRank | null;
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
 * `bestResponse`/`note`/every `Trial4BenchmarkResponse.humanAcceptable`/
 * `humanRank` are set exactly once, at judgment submission (`judged` flips
 * `false` -> `true` atomically with them) — `revealed` toggling afterward
 * must never mutate any of those fields (docs/decisions/0017, Operator
 * Decision 6: "The recorded judgment must not change automatically after
 * identities are revealed").
 */
export interface Trial4BenchmarkResult {
  id: string;
  caseId: string;
  labelMapping: Record<Trial4BenchmarkLabel, Trial4BenchmarkResponse>;
  /**
   * **Derived, not independently chosen** — the label whose
   * `humanRank === 1` after submission, or `null` if no response was
   * acceptable. No separate "pick a winner" UI step exists; rank-1 IS the
   * winner by construction, so this field only exists for convenient
   * display without re-scanning `labelMapping`
   * (docs/decisions/0017's "acceptability gate + ranking" addendum — the
   * prior "Best response: A/B/C/Tie" free choice, including tie support,
   * is removed for the first pass, per explicit operator instruction: "do
   * not let tie handling make the UI complicated").
   */
  bestResponse: Trial4BenchmarkLabel | null;
  note: string;
  /** True once the operator has submitted acceptability (+ rank, where acceptable) for every label in this case. */
  judged: boolean;
  /** UI-only "show model identities" toggle — never affects any judgment field. */
  revealed: boolean;
  computedAt: string;
  judgedAt?: string;
}
