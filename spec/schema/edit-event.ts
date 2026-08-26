/**
 * AI/machine suggestion -> human-edited final output pair, per the design
 * doc's "Human post-editing as supervision" section — treated as
 * high-quality passive-learning evidence. Canonical evidence, captured via
 * an explicit in-extension form in the MVP (not live cross-site DOM
 * capture — see docs/decisions/0005).
 */
export interface EditEvent {
  id: string;
  /** The AI/machine-generated suggestion before editing. */
  sourceText: string;
  /** The human-edited final output. */
  finalText: string;
  context?: {
    surface?: string;
    language?: string;
  };
  createdAt: string;
}
