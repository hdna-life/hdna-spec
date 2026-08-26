/**
 * Shared metadata every HDNA inference/observation should carry, per the
 * design doc's "canonical layers" section. Schema only — no population logic
 * exists in the MVP foundation.
 */

export type PrivacyLevel = 'LOCAL_ONLY' | 'DERIVABLE' | 'SHAREABLE' | 'PUBLIC';

export interface Provenance {
  /** Identifier of the observation/source event this record derives from. */
  sourceEventId: string;
  /** Id/version of the extractor or process that produced this record. */
  extractorId: string;
  extractorVersion: string;
}

export interface EvidenceMetadata {
  provenance: Provenance;
  /** 0..1 confidence in this record; absent when not yet estimated. */
  confidence?: number;
  createdAt: string;
  /** ISO timestamp after which this record should be considered stale, if applicable. */
  validUntil?: string;
  privacy: PrivacyLevel;
}
