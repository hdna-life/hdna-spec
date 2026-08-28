import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type {
  Trial4BenchmarkLabel,
  Trial4BenchmarkRank,
  Trial4BenchmarkResponse,
  Trial4BenchmarkResult,
  Trial4BenchmarkRole,
} from '@spec/schema/trial4-benchmark-result';
import type { BehaviorDimensionChange, SemanticChangeVerdict, SemanticRevisionJudgeProvider } from '@spec/protocol/semantic-revision-judge';
import { isValidDimensionsArray } from './behavior-dimension';
import type { Trial4BenchmarkCaseStore } from './trial4-benchmark-case-store';
import type { Trial4BenchmarkResultStore } from './trial4-benchmark-result-store';
import type { Trial4BenchmarkConfig, Trial4BenchmarkConfigStore } from './trial4-benchmark-config-store';

const VALID_GROUND_TRUTH_VERDICTS = new Set([
  'no_meaningful_change',
  'meaning_added',
  'meaning_removed',
  'meaning_transformed',
  'uncertain',
]);

/** Fixed evaluation order — randomization happens in which LABEL each role lands on, never in which roles are evaluated. */
const ROLES: Trial4BenchmarkRole[] = ['base', 'trained', 'deepseek'];
const LABELS: Trial4BenchmarkLabel[] = ['A', 'B', 'C'];

export type Trial4ProviderSet = Record<Trial4BenchmarkRole, SemanticRevisionJudgeProvider>;
export type Trial4ProviderSetFactory = (config: Trial4BenchmarkConfig) => Trial4ProviderSet;

/** Fisher-Yates shuffle of the fixed A/B/C label set — the default, non-deterministic randomization; tests inject a fixed order instead. */
function shuffledLabels(): Trial4BenchmarkLabel[] {
  const labels = [...LABELS];
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  return labels;
}

/**
 * Trial 4's blind three-way benchmark orchestration (docs/decisions/0017).
 * For one held-out case, calls all three anonymized systems (base Qwen,
 * trained Qwen, DeepSeek) via the exact same `SemanticRevisionJudgeProvider`
 * interface Trial 3 already established — no new judging contract, per
 * "reuse the existing Trial 3 quantitative evaluation" — and stores the
 * result with each response's real `role` attached but its A/B/C `label`
 * assignment randomized per case (Operator Decision 6: blind comparison).
 *
 * Blindness is a UI concern, not a storage concern: `role` is always
 * present in the stored `labelMapping`, exactly like every other
 * experimental config/data store in this codebase is "not encrypted,
 * local-only" rather than cryptographically hidden. `reveal()` only ever
 * flips `revealed`; it is structurally incapable of touching `grade`/
 * `bestResponse`/`note`, since those live in a completely separate method
 * (`submitJudgment`) that `reveal()` never calls.
 *
 * A provider failure for one role does not abort the case — it is
 * recorded as that label's `error`, still gradeable by the operator
 * (almost always as `'wrong'`), same untrusted-output/no-silent-failure
 * discipline as Trial 3.
 */
export class Trial4BenchmarkService {
  constructor(
    /** Constructs all three providers fresh from the *current* config on every runNextCase() call — never a stale endpoint/key from an earlier save. */
    private createProviders: Trial4ProviderSetFactory,
    private caseStore: Trial4BenchmarkCaseStore,
    private resultStore: Trial4BenchmarkResultStore,
    private configStore: Trial4BenchmarkConfigStore,
    private randomLabelOrder: () => Trial4BenchmarkLabel[] = shuffledLabels,
    private now: () => string = () => new Date().toISOString(),
    private randomId: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Runs the next not-yet-benchmarked held-out case (a case with no
   * existing `Trial4BenchmarkResult`, judged or not — a case is only ever
   * benchmarked once, matching the "do not repeatedly optimize against
   * the held-out benchmark" evaluation-integrity rule). **Only considers
   * cases with `groundTruthLocked === true`** (Test 1 evaluation-stage
   * addendum) — a case whose ground truth the operator has not yet locked
   * is skipped entirely; models must never run against, and the operator
   * must never blind-grade, a case whose answer key could still change.
   * Returns `undefined` when every locked case already has a result (or
   * no case is locked yet) — a valid, expected terminal state, not a
   * failure.
   */
  async runNextCase(): Promise<Trial4BenchmarkResult | undefined> {
    const config = await this.configStore.get();
    if (
      !config.enabled ||
      !config.baseModelUrl ||
      !config.trainedModelUrl ||
      !config.localModelId ||
      !config.openRouterApiKey ||
      !config.deepSeekModelId
    ) {
      throw new Error('Trial 4 benchmark is not enabled/configured');
    }

    const [cases, results] = await Promise.all([this.caseStore.list(), this.resultStore.list()]);
    const benchmarkedCaseIds = new Set(results.map((result) => result.caseId));
    const nextCase = cases.find(
      (benchmarkCase) => benchmarkCase.groundTruthLocked && !benchmarkedCaseIds.has(benchmarkCase.id),
    );
    if (!nextCase) return undefined;

    const providers = this.createProviders(config);
    const labels = this.randomLabelOrder();

    const responses = await Promise.all(ROLES.map((role) => this.judgeWithRole(providers[role], role, nextCase)));

    const labelMapping = {} as Record<Trial4BenchmarkLabel, Trial4BenchmarkResponse>;
    ROLES.forEach((_role, index) => {
      labelMapping[labels[index]] = responses[index];
    });

    const result: Trial4BenchmarkResult = {
      id: this.randomId(),
      caseId: nextCase.id,
      labelMapping,
      bestResponse: null,
      note: '',
      judged: false,
      revealed: false,
      computedAt: this.now(),
    };
    await this.resultStore.put(result);
    return result;
  }

  private async judgeWithRole(
    provider: SemanticRevisionJudgeProvider,
    role: Trial4BenchmarkRole,
    benchmarkCase: Trial4BenchmarkCase,
  ): Promise<Trial4BenchmarkResponse> {
    try {
      // Deliberately destructures only the five SemanticRevisionJudgeInput
      // fields — benchmarkCase.humanVerdict/humanDimensions (frozen
      // ground truth, Test 1 addendum) are never forwarded to a model,
      // enforced structurally here, not just by convention.
      const judgment = await provider.judge({
        kind: benchmarkCase.kind,
        originalText: benchmarkCase.originalText,
        finalText: benchmarkCase.finalText,
        beforeContext: benchmarkCase.beforeContext,
        afterContext: benchmarkCase.afterContext,
      });
      return {
        role,
        verdict: judgment.verdict,
        dimensions: judgment.dimensions,
        description: judgment.description,
        confidence: judgment.confidence,
        error: null,
        grade: null,
        humanAcceptable: null,
        humanRank: null,
      };
    } catch (err) {
      return {
        role,
        verdict: null,
        dimensions: [],
        description: null,
        confidence: null,
        error: err instanceof Error ? err.message : String(err),
        grade: null,
        humanAcceptable: null,
        humanRank: null,
      };
    }
  }

  /**
   * Records the operator's blind judgment using the acceptability-gate +
   * ranking model (docs/decisions/0017's "acceptability gate + ranking"
   * addendum, superseding the earlier Correct/Partial/Wrong + free-choice
   * "Best response" model). For each label: `acceptable` is required;
   * `rank` MUST be `null` when `acceptable` is `false` — an unacceptable
   * response can never receive a rank — and when one or more labels are
   * acceptable, their `rank` values must form a dense 1..N permutation (no
   * gaps, no duplicates, N = count of acceptable labels in this
   * submission). Throws on any violation of that structural invariant
   * rather than silently repairing it (same untrusted-input discipline as
   * the rest of Trial 3/4). `bestResponse` is derived here, not supplied
   * by the caller — it is simply whichever label has `rank === 1`, or
   * `null` if zero responses were acceptable (itself a valid, meaningful,
   * explicitly-recorded outcome, not an error).
   *
   * Throws if the result is already judged — a result is judged exactly
   * once; re-grading after reveal is not supported, per Operator Decision
   * 6 ("the recorded judgment must not change automatically after
   * identities are revealed" — this method enforces that a *manual*
   * re-judgment isn't possible either, since there is no separate "edit"
   * path).
   */
  async submitJudgment(
    resultId: string,
    acceptability: Record<Trial4BenchmarkLabel, { acceptable: boolean; rank: Trial4BenchmarkRank | null }>,
    note: string,
  ): Promise<Trial4BenchmarkResult> {
    const result = await this.resultStore.get(resultId);
    if (!result) throw new Error(`No Trial 4 benchmark result with id "${resultId}"`);
    if (result.judged) throw new Error('This Trial 4 benchmark result has already been judged');

    const acceptableLabels = LABELS.filter((label) => acceptability[label].acceptable);
    const unacceptableLabels = LABELS.filter((label) => !acceptability[label].acceptable);

    if (unacceptableLabels.some((label) => acceptability[label].rank !== null)) {
      throw new Error('An unacceptable response must not carry a rank');
    }
    const ranks = acceptableLabels.map((label) => acceptability[label].rank);
    if (ranks.some((rank) => rank === null)) {
      throw new Error('Every acceptable response must have a rank');
    }
    const expectedRanks = acceptableLabels.map((_label, index) => index + 1);
    if (JSON.stringify([...ranks].sort()) !== JSON.stringify(expectedRanks)) {
      throw new Error(
        `Acceptable responses must be ranked as a dense 1..${acceptableLabels.length} permutation with no duplicates`,
      );
    }

    const bestResponse = acceptableLabels.find((label) => acceptability[label].rank === 1) ?? null;

    const updated: Trial4BenchmarkResult = {
      ...result,
      labelMapping: {
        A: { ...result.labelMapping.A, humanAcceptable: acceptability.A.acceptable, humanRank: acceptability.A.rank },
        B: { ...result.labelMapping.B, humanAcceptable: acceptability.B.acceptable, humanRank: acceptability.B.rank },
        C: { ...result.labelMapping.C, humanAcceptable: acceptability.C.acceptable, humanRank: acceptability.C.rank },
      },
      bestResponse,
      note,
      judged: true,
      judgedAt: this.now(),
    };
    await this.resultStore.put(updated);
    return updated;
  }

  /**
   * Records the operator's frozen ground truth for one held-out case and
   * locks it (Test 1 evaluation-stage addendum, docs/decisions/0017). Once
   * locked, `humanVerdict`/`humanDimensions` cannot be changed through this
   * method again — it throws if the case is already locked, same
   * "committed, not editable" discipline as `submitJudgment`. Validates the
   * draft with the same rules as a judge's own output (`isValidDimensionsArray`,
   * `'uncertain'` verdict must carry `dimensions: []`) — a malformed ground
   * truth is rejected here, never silently repaired. Locking a case makes
   * it eligible for `runNextCase`; before locking, `runNextCase` will never
   * select it.
   */
  async lockGroundTruth(
    caseId: string,
    humanVerdict: SemanticChangeVerdict,
    humanDimensions: BehaviorDimensionChange[],
  ): Promise<Trial4BenchmarkCase> {
    const benchmarkCase = await this.caseStore.get(caseId);
    if (!benchmarkCase) throw new Error(`No Trial 4 benchmark case with id "${caseId}"`);
    if (benchmarkCase.groundTruthLocked) {
      throw new Error('This Trial 4 benchmark case\'s ground truth is already locked');
    }
    if (!VALID_GROUND_TRUTH_VERDICTS.has(humanVerdict)) {
      throw new Error(`Invalid ground truth verdict "${humanVerdict}"`);
    }
    if (!isValidDimensionsArray(humanDimensions)) {
      throw new Error('Invalid ground truth dimensions array');
    }
    if (humanVerdict === 'uncertain' && humanDimensions.length > 0) {
      throw new Error('An "uncertain" ground truth verdict must carry dimensions: []');
    }

    const updated: Trial4BenchmarkCase = {
      ...benchmarkCase,
      humanVerdict,
      humanDimensions,
      groundTruthLocked: true,
      groundTruthLockedAt: this.now(),
    };
    await this.caseStore.put(updated);
    return updated;
  }

  /**
   * Flips `revealed` only. Deliberately cannot be reached before the blind
   * evaluation has been committed — throws if the result is not yet
   * `judged` (Test 1 evaluation-stage addendum: model identities must
   * remain hidden until ground truth is locked, models have run, and the
   * operator's acceptable/rank judgment for every label is committed).
   * Never touches any other field — see this class's docstring.
   */
  async reveal(resultId: string): Promise<Trial4BenchmarkResult> {
    const result = await this.resultStore.get(resultId);
    if (!result) throw new Error(`No Trial 4 benchmark result with id "${resultId}"`);
    if (!result.judged) {
      throw new Error('Cannot reveal model identities before the blind evaluation is committed');
    }
    const updated: Trial4BenchmarkResult = { ...result, revealed: true };
    await this.resultStore.put(updated);
    return updated;
  }
}
