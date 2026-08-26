import type { SemanticDeltaCandidate } from '@spec/schema/semantic-delta-candidate';
import type { SemanticDeltaExtractionReceipt } from '@spec/schema/semantic-delta-extraction-receipt';
import type { SemanticDeltaExtractorProvider } from '@spec/protocol/semantic-delta-extractor';
import type { StorageAdapter } from '../storage/types';
import type { EditEventStore } from './edit-event-store';
import type { SemanticDeltaCandidateStore } from './semantic-delta-candidate-store';
import type { SemanticDeltaExtractionReceiptStore } from './semantic-delta-extraction-receipt-store';
import type { SemanticDeltaExtractorConfigStore } from './semantic-delta-extractor-config-store';
import { validateCandidateDraft } from './semantic-delta-extractor';

export type SemanticDeltaExtractorProviderFactory = (
  apiKey: string,
  modelId: string,
) => SemanticDeltaExtractorProvider;

/**
 * Orchestrates Phase 5A extraction: EditEventStore -> (skip
 * already-processed sources, per the receipt store) -> provider.extract()
 * -> validated SemanticDeltaCandidates -> SemanticDeltaCandidateStore,
 * with a SemanticDeltaExtractionReceipt written for every source
 * regardless of outcome. Unlike PatternCompilerService/PersonaInterpreterService,
 * this is NOT a full-rebuild service — it mirrors TraitClassifierService's
 * per-source, idempotent-by-construction shape instead, since re-running
 * would otherwise re-send raw edit-pair text to the configured model. See
 * docs/decisions/0016.
 */
export class SemanticDeltaExtractionService {
  constructor(
    private storage: StorageAdapter,
    /**
     * Constructs the provider fresh from the *current* config on every
     * runExperiment() call — same reasoning as PersonaInterpreterService
     * (docs/decisions/0015): never call OpenRouter with a stale API
     * key/model id from an earlier popup save.
     */
    private createProvider: SemanticDeltaExtractorProviderFactory,
    private editEventStore: EditEventStore,
    private candidateStore: SemanticDeltaCandidateStore,
    private receiptStore: SemanticDeltaExtractionReceiptStore,
    private configStore: SemanticDeltaExtractorConfigStore,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async runExperiment(): Promise<SemanticDeltaCandidate[]> {
    const config = await this.configStore.get();
    if (!config.enabled || !config.apiKey || !config.modelId) {
      throw new Error('Semantic delta extraction experiment is not enabled/configured');
    }

    const [editEvents, receipts] = await Promise.all([this.editEventStore.list(), this.receiptStore.list()]);
    const receiptsBySourceId = new Map(receipts.map((receipt) => [receipt.sourceEvidenceId, receipt]));
    const provider = this.createProvider(config.apiKey, config.modelId);

    const newCandidates: SemanticDeltaCandidate[] = [];
    for (const event of editEvents) {
      const sourceEvidenceId = `edit_event:${event.id}`;
      const existingReceipt = receiptsBySourceId.get(sourceEvidenceId);
      // Skipped only when the SAME extractor identity/version already
      // processed this source, whether it extracted candidates OR
      // abstained — both outcomes are recorded as a receipt, so a
      // correctly-abstained pair (zero candidates) is never mistaken for
      // "never processed" and re-sent to the model. A deliberate
      // extractor/model change (different providerId/modelId) is NOT
      // skipped, so an intentional re-extraction with a new extractor
      // version can still process this source again. See
      // docs/decisions/0016.
      if (
        existingReceipt &&
        existingReceipt.extractorId === provider.providerId &&
        existingReceipt.extractorVersion === provider.modelId
      ) {
        continue;
      }

      const drafts = await provider.extract({
        originalText: event.sourceText,
        finalText: event.finalText,
        context: event.context?.surface ?? 'unscoped',
      });
      const validDrafts = drafts.filter(validateCandidateDraft);

      if (validDrafts.length === 0) {
        const receipt: SemanticDeltaExtractionReceipt = {
          sourceEvidenceId,
          extractorId: provider.providerId,
          extractorVersion: provider.modelId,
          outcome: 'abstained',
          processedAt: this.now(),
        };
        await this.receiptStore.put(receipt);
        continue;
      }

      const candidates: SemanticDeltaCandidate[] = validDrafts.map((draft) => ({
        id: crypto.randomUUID(),
        sourceEvidenceId,
        kind: draft.kind,
        observation: draft.observation,
        preferred: draft.preferred,
        rejected: draft.rejected,
        context: draft.context,
        confidence: draft.confidence,
        extractorId: provider.providerId,
        extractorVersion: provider.modelId,
        computedAt: this.now(),
      }));
      const receipt: SemanticDeltaExtractionReceipt = {
        sourceEvidenceId,
        extractorId: provider.providerId,
        extractorVersion: provider.modelId,
        outcome: 'extracted',
        processedAt: this.now(),
      };

      // Candidates and the receipt land atomically in one write — a crash
      // between the two can never leave candidates persisted without the
      // receipt that prevents resubmitting this source's raw text later.
      await this.storage.putMany([
        ...candidates.map((candidate) => this.candidateStore.entryFor(candidate)),
        this.receiptStore.entryFor(receipt),
      ]);
      newCandidates.push(...candidates);
    }

    return newCandidates;
  }
}
