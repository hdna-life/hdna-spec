/**
 * A real writing sample explicitly provided by the user during Phase 1
 * cold-start onboarding. Canonical evidence — never derived/rebuildable.
 *
 * Full context taxonomy (writing.public_social, writing.private_message,
 * audience, conversation identifiers, etc., per the design doc's "Context
 * metadata" section) is SPEC_RESERVED; only a minimal free-text `surface`
 * and `language` hint are captured for the MVP.
 */
export interface WritingSample {
  id: string;
  text: string;
  context?: {
    surface?: string;
    language?: string;
  };
  createdAt: string;
}
