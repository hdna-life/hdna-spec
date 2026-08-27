import type { SemanticDeltaExtractionReceipt } from '@spec/schema/semantic-delta-extraction-receipt';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const RECEIPT_STORE = 'semantic_delta_extraction_receipts';

/**
 * Processing provenance, keyed by sourceEvidenceId — one receipt per
 * source, regardless of outcome. A source is skipped only when its stored
 * receipt's extractorId/extractorVersion matches the *current* provider's
 * identity (see SemanticDeltaExtractionService.runExperiment()) — an
 * intentional extractor/model change is NOT skipped and reprocesses the
 * source automatically, without needing to clear this store first. See
 * docs/decisions/0016.
 */
export class SemanticDeltaExtractionReceiptStore {
  constructor(private storage: StorageAdapter) {}

  /** Storage entry descriptor, for composing an atomic multi-key write via StorageAdapter.putMany() alongside candidate writes. */
  entryFor(receipt: SemanticDeltaExtractionReceipt): StorageEntry<SemanticDeltaExtractionReceipt> {
    return { store: RECEIPT_STORE, key: receipt.sourceEvidenceId, value: receipt, storageClass: 'DERIVED' };
  }

  async put(receipt: SemanticDeltaExtractionReceipt): Promise<void> {
    await this.storage.put(RECEIPT_STORE, receipt.sourceEvidenceId, receipt, 'DERIVED');
  }

  get(sourceEvidenceId: string): Promise<SemanticDeltaExtractionReceipt | undefined> {
    return this.storage.get<SemanticDeltaExtractionReceipt>(RECEIPT_STORE, sourceEvidenceId);
  }

  list(): Promise<SemanticDeltaExtractionReceipt[]> {
    return this.storage.query<SemanticDeltaExtractionReceipt>(RECEIPT_STORE);
  }

  async clear(): Promise<void> {
    for (const receipt of await this.list()) {
      await this.storage.delete(RECEIPT_STORE, receipt.sourceEvidenceId);
    }
  }
}
