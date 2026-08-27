import type { SemanticDeltaCandidate } from '@spec/schema/semantic-delta-candidate';
import type { SemanticDeltaExtractionReceipt } from '@spec/schema/semantic-delta-extraction-receipt';
import type { SemanticRevisionJudgeProvider } from '@spec/protocol/semantic-revision-judge';
import type { StorageAdapter } from '../storage/types';
import type { EditEventStore } from './edit-event-store';
import type { SemanticDeltaCandidateStore } from './semantic-delta-candidate-store';
import type { SemanticDeltaExtractionReceiptStore } from './semantic-delta-extraction-receipt-store';
import type { SemanticRevisionJudgeConfigStore } from './semantic-revision-judge-config-store';
import { computeRevisionDiff } from './revision-diff';
import { buildRevisionInterventions } from './revision-intervention';
import { admitJudgment } from './semantic-revision-admission';

/**
 * Constructs whichever `SemanticRevisionJudgeProvider` transport is wired
 * up (`entrypoints/background.ts`) — currently local MLX
 * (`LocalMlxSemanticRevisionJudge`), previously OpenRouter
 * (`OpenRouterSemanticRevisionJudge`) for the same interface. This service
 * has no notion of which transport it is: swapping `baseUrl`/`modelId` for
 * an OpenRouter `apiKey`/`modelId` shape (or a future WebGPU provider)
 * requires changing only the factory passed in at construction, never this
 * file's orchestration logic. `baseUrl` is named generically (not
 * `apiKey`) because Trial 3's real transport is now local — see
 * docs/decisions/0016's Trial 3 "local MLX transport" addendum.
 */
export type SemanticRevisionJudgeProviderFactory = (
  baseUrl: string,
  modelId: string,
) => SemanticRevisionJudgeProvider;

/**
 * Per-run counters for Trial 3's evaluation criteria (docs/decisions/0016's
 * Trial 3 §18) — SUPPORTED/PARTIALLY_SUPPORTED/UNSUPPORTED rates are still
 * graded by the human operator against persisted candidates, but coverage,
 * abstention, and call-count questions are answerable directly from these
 * counters without re-deriving them from storage.
 */
export interface SemanticRevisionJudgeStats {
  sourcesProcessed: number;
  sourcesSkipped: number;
  interventionsTotal: number;
  interventionsDeduped: number;
  judgeCalls: number;
  judgeFailures: number;
  noMeaningfulChange: number;
  uncertain: number;
  admitted: number;
  /**
   * Message from the most recent `provider.judge()` failure, if any —
   * lightweight failure-attribution surfacing (Trial 3 §12), not a full
   * telemetry system. `LocalMlxSemanticRevisionJudge` throws
   * `LocalMlxUnreachableError` with a message naming the unreachable
   * `baseUrl` specifically when the local server could not be reached at
   * all, distinguishable (by message content) from a malformed-response
   * failure — this field is what lets the popup UI surface "the local MLX
   * model could not be reached" instead of a generic failure count.
   */
  lastJudgeFailureMessage?: string;
}

export interface SemanticRevisionJudgeRunResult {
  candidates: SemanticDeltaCandidate[];
  stats: SemanticRevisionJudgeStats;
}

/**
 * Trial 3 orchestration (docs/decisions/0016's Trial 3 section):
 *
 *   EditEventStore
 *     -> deterministic localization        (revision-diff.ts, reused unchanged from Trial 2)
 *     -> deterministic intervention units   (revision-intervention.ts)
 *     -> one narrow judge call per intervention (SemanticRevisionJudgeProvider)
 *     -> deterministic admission gate       (semantic-revision-admission.ts)
 *     -> SemanticDeltaCandidate
 *
 * A structurally separate service from `SemanticDeltaExtractionService`
 * (Trial 0-2), not a modification of it — both remain independently
 * runnable, and their receipts/candidates stay distinguishable from each
 * other by `extractorId` (e.g. `local-mlx/deterministic-semantic-judge-v3`
 * vs. `openrouter/deterministic-semantic-judge-v3` — see whichever
 * `SemanticRevisionJudgeProvider.providerId` is currently wired in
 * `entrypoints/background.ts`).
 * Same receipt-gated, per-source idempotency discipline as Trial 0-2: a
 * source is skipped only when its existing receipt's
 * `extractorId`/`extractorVersion` matches the *current* provider's
 * identity; an abstained source (zero admitted candidates) still writes a
 * receipt, so it is never re-sent.
 *
 * Failure isolation (Trial 3 §16) — four distinguishable stages per
 * intervention, kept visible in this method's structure rather than a new
 * observability system:
 *   LOCALIZATION FAILURE — would surface from `computeRevisionDiff`/
 *     `buildRevisionInterventions` themselves throwing; both are pure,
 *     total functions over arbitrary strings (revision-diff.ts's own
 *     `MAX_DP_CELLS` fallback avoids throwing on oversized input), so this
 *     stage does not have a per-intervention try/catch — a failure here
 *     would be a real bug, not an expected outcome, and should abort loudly.
 *   SEMANTIC JUDGE FAILURE — `provider.judge()` throwing (malformed
 *     response, non-ok HTTP, schema mismatch) is caught per intervention
 *     and counted in `stats.judgeFailures`; it does not abort the rest of
 *     the source's interventions or the run.
 *   ADMISSION FAILURE — `admitJudgment()` returning `null` (rejected
 *     verdict, invalid judgment shape) is not an exception; it is counted
 *     via `stats.noMeaningfulChange`/`stats.uncertain` and simply produces
 *     no candidate for that intervention.
 *   PERSISTENCE FAILURE — `storage.putMany()` throwing propagates out of
 *     `runExperiment()` unmodified; there is exactly one persistence call
 *     per source, so a thrown error unambiguously identifies this stage.
 */
export class SemanticRevisionJudgeExtractionService {
  constructor(
    private storage: StorageAdapter,
    /** Constructs the provider fresh from the *current* config on every runExperiment() call — never a stale API key/model id from an earlier save. */
    private createProvider: SemanticRevisionJudgeProviderFactory,
    private editEventStore: EditEventStore,
    private candidateStore: SemanticDeltaCandidateStore,
    private receiptStore: SemanticDeltaExtractionReceiptStore,
    private configStore: SemanticRevisionJudgeConfigStore,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async runExperiment(): Promise<SemanticRevisionJudgeRunResult> {
    const config = await this.configStore.get();
    if (!config.enabled || !config.baseUrl || !config.modelId) {
      throw new Error('Semantic revision judge experiment is not enabled/configured');
    }

    const [editEvents, receipts] = await Promise.all([this.editEventStore.list(), this.receiptStore.list()]);
    const receiptsBySourceId = new Map(receipts.map((receipt) => [receipt.sourceEvidenceId, receipt]));
    const provider = this.createProvider(config.baseUrl, config.modelId);

    const stats: SemanticRevisionJudgeStats = {
      sourcesProcessed: 0,
      sourcesSkipped: 0,
      interventionsTotal: 0,
      interventionsDeduped: 0,
      judgeCalls: 0,
      judgeFailures: 0,
      noMeaningfulChange: 0,
      uncertain: 0,
      admitted: 0,
    };
    const newCandidates: SemanticDeltaCandidate[] = [];

    for (const event of editEvents) {
      const sourceEvidenceId = `edit_event:${event.id}`;
      const existingReceipt = receiptsBySourceId.get(sourceEvidenceId);
      if (
        existingReceipt &&
        existingReceipt.extractorId === provider.providerId &&
        existingReceipt.extractorVersion === provider.modelId
      ) {
        stats.sourcesSkipped += 1;
        continue;
      }

      // --- LOCALIZATION (deterministic, no model involved) -----------------
      const diff = computeRevisionDiff(event.sourceText, event.finalText);
      const interventions = buildRevisionInterventions(sourceEvidenceId, diff);
      stats.interventionsTotal += interventions.length;

      const seenInterventions = new Set<string>();
      const sourceCandidates: SemanticDeltaCandidate[] = [];

      for (const intervention of interventions) {
        // Local, deterministic dedup guard (Trial 3 §5.6) — no embeddings,
        // no global/cross-user deduplication. Duplicates within one run
        // are not expected from computeRevisionDiff's non-overlapping
        // spans, but this guard makes the discipline explicit and testable.
        const dedupeKey = `${intervention.sourceEvidenceId}:${intervention.kind}:${intervention.originalText}:${intervention.finalText}`;
        if (seenInterventions.has(dedupeKey)) {
          stats.interventionsDeduped += 1;
          continue;
        }
        seenInterventions.add(dedupeKey);

        // --- SEMANTIC JUDGE (the only model call in this pipeline) --------
        stats.judgeCalls += 1;
        let judgment;
        try {
          judgment = await provider.judge({
            kind: intervention.kind,
            originalText: intervention.originalText,
            finalText: intervention.finalText,
            beforeContext: intervention.beforeContext,
            afterContext: intervention.afterContext,
          });
        } catch (err) {
          stats.judgeFailures += 1;
          stats.lastJudgeFailureMessage = err instanceof Error ? err.message : String(err);
          continue;
        }

        if (judgment.verdict === 'no_meaningful_change') stats.noMeaningfulChange += 1;
        if (judgment.verdict === 'uncertain') stats.uncertain += 1;

        // --- ADMISSION (deterministic; HDNA, not the model, decides) -----
        const draft = admitJudgment(intervention, judgment, event.context?.surface ?? 'unscoped');
        if (!draft) continue;
        stats.admitted += 1;

        sourceCandidates.push({
          id: crypto.randomUUID(),
          sourceEvidenceId,
          interventionId: intervention.id,
          kind: draft.kind,
          observation: draft.observation,
          preferred: draft.preferred,
          rejected: draft.rejected,
          context: draft.context,
          confidence: draft.confidence,
          extractorId: provider.providerId,
          extractorVersion: provider.modelId,
          computedAt: this.now(),
        });
      }

      const outcome = sourceCandidates.length === 0 ? 'abstained' : 'extracted';
      const receipt: SemanticDeltaExtractionReceipt = {
        sourceEvidenceId,
        extractorId: provider.providerId,
        extractorVersion: provider.modelId,
        outcome,
        processedAt: this.now(),
      };

      // --- PERSISTENCE (candidates + receipt written atomically) ---------
      await this.storage.putMany([
        ...sourceCandidates.map((candidate) => this.candidateStore.entryFor(candidate)),
        this.receiptStore.entryFor(receipt),
      ]);
      newCandidates.push(...sourceCandidates);
      stats.sourcesProcessed += 1;
    }

    return { candidates: newCandidates, stats };
  }
}
