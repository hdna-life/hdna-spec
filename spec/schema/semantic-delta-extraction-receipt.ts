export type SemanticDeltaExtractionOutcome = 'extracted' | 'abstained';

/**
 * Processing provenance, not persona evidence — records that a source was
 * already sent to the extractor, regardless of outcome, so it is never
 * resubmitted. Carries no evidence text. Exists specifically because
 * "does a candidate already exist for this source" cannot represent a
 * successful abstention (zero candidates), which would otherwise cause
 * the same raw edit-pair text to be re-sent to the configured model on
 * every later experiment run — see docs/decisions/0016.
 */
export interface SemanticDeltaExtractionReceipt {
  sourceEvidenceId: string;
  extractorId: string;
  extractorVersion: string;
  outcome: SemanticDeltaExtractionOutcome;
  processedAt: string;
}
