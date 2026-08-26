/**
 * Trial 3's narrow semantic-judge contract (docs/decisions/0016's Trial 3
 * section) — deliberately much smaller than
 * `spec/protocol/semantic-delta-extractor.ts`'s `SemanticDeltaExtractorProvider`.
 * Where Trial 0-2's provider is handed a whole EditEvent (ORIGINAL + FINAL)
 * and asked to discover, localize, and interpret an arbitrary number of
 * semantic deltas in one call, this provider is handed exactly one
 * deterministically-localized `RevisionIntervention`
 * (`extension/src/persona/revision-intervention.ts`) and asked only:
 * "does this one localized change carry a directly observable semantic
 * effect, and if so, what is it?" This is the contract a WebGPU-scale
 * small model is expected to be able to satisfy; discovering boundaries,
 * deduplicating, and deciding persona relevance remain deterministic HDNA
 * responsibilities (see `extension/src/persona/revision-intervention.ts`,
 * `semantic-revision-admission.ts`, `semantic-revision-judge-extraction-service.ts`).
 *
 * `'preserved'` is deliberately excluded from `RevisionInterventionKind`:
 * purely preserved regions are never sent to this provider as independent
 * units (docs/decisions/0016 Trial 3 §5.3) — they may only appear as
 * `beforeContext`/`afterContext` on a real intervention.
 */
export type RevisionInterventionKind = 'added' | 'removed' | 'replaced' | 'reordered';

export interface SemanticRevisionJudgeInput {
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  /** Short trailing excerpt of the nearest preceding preserved span, or '' if none. Context only — never itself a judgeable unit. */
  beforeContext: string;
  /** Short leading excerpt of the nearest following preserved span, or '' if none. Context only — never itself a judgeable unit. */
  afterContext: string;
}

/**
 * Deliberately five values, not a persona taxonomy — describes the
 * relation between the localized textual intervention and its meaning,
 * never the person. `'uncertain'` and `'no_meaningful_change'` are both
 * valid, expected outcomes, not failures — abstention is a first-class
 * result (same discipline as Trial 0-2's empty-candidates-array
 * abstention). See docs/decisions/0016's Trial 3 §7.
 */
export type SemanticChangeVerdict =
  | 'no_meaningful_change'
  | 'meaning_added'
  | 'meaning_removed'
  | 'meaning_transformed'
  | 'uncertain';

/**
 * A single narrow semantic judgment, before HDNA's deterministic admission
 * gate (`extension/src/persona/semantic-revision-admission.ts`) decides
 * whether it becomes persona evidence. `description` is `null` whenever no
 * semantic change is claimed (`'no_meaningful_change'`/`'uncertain'`) —
 * required (not optional) so a strict-schema OpenAI/Azure-compatible
 * provider can express "not applicable" without an unsupported optional
 * JSON Schema property, same wire-vs-domain discipline
 * `openrouter-semantic-delta-extractor.ts` already established for
 * `preferred`/`rejected` (docs/decisions/0016's "Post-implementation fix"
 * section) — reused here rather than reinvented.
 */
export interface SemanticRevisionJudgmentDraft {
  verdict: SemanticChangeVerdict;
  description: string | null;
  confidence: number;
}

/**
 * Provider-agnostic Trial 3 contract, mirroring
 * `SemanticDeltaExtractorProvider`/`EmbeddingProvider`/`TinyClassifier`'s
 * shape: no fetch/API-key/HTTP concept here. One call judges exactly one
 * intervention — never a whole EditEvent, never an arbitrary candidate
 * set. See docs/decisions/0016's Trial 3 section.
 */
export interface SemanticRevisionJudgeProvider {
  readonly providerId: string;
  readonly modelId: string;
  judge(input: SemanticRevisionJudgeInput): Promise<SemanticRevisionJudgmentDraft>;
}
