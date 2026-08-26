/**
 * Deliberately small — two values only. `contrastive_preference` is for
 * edits with a genuine "kept X over Y" relation; `behavioral_delta` is for
 * any other directly-observable semantic difference (added/removed
 * reasoning, strengthened/weakened a position, changed framing, etc.) that
 * doesn't reduce to a clean preference pair. Do not add a third value
 * without a deliberate schema/ADR change — this is not meant to grow into
 * a general taxonomy. See docs/decisions/0016.
 */
export type SemanticDeltaCandidateKind = 'contrastive_preference' | 'behavioral_delta';

/**
 * A single, directly-observed semantic difference between an AI draft and
 * a human's final edit — Phase 5A's experimental evidence unit (see
 * docs/decisions/0016). Never a canonical fact, never a trait/belief:
 * deliberately excludes any field resembling a trait name, personality
 * dimension, or stability/frequency counter that would presuppose the
 * thing this experiment is testing whether the evidence can support. This
 * discipline holds regardless of `kind` — `behavioral_delta` is not a
 * looser category, it is the same epistemic discipline applied to
 * non-contrastive observations.
 */
export interface SemanticDeltaCandidate {
  id: string;
  /** "edit_event:<id>" — the one and only source type for this Phase 5A slice. */
  sourceEvidenceId: string;
  kind: SemanticDeltaCandidateKind;
  /** Always present: a concrete, directly-observed description of the semantic delta — not a trait label, regardless of kind. */
  observation: string;
  /** Only meaningful (and required by validation) when kind === 'contrastive_preference' — what the human's final text kept/preferred. Omitted for 'behavioral_delta'. */
  preferred?: string;
  /** Only meaningful (and required by validation) when kind === 'contrastive_preference' — what the edit moved away from. Omitted for 'behavioral_delta'. */
  rejected?: string;
  /** Same context-scoping convention as Pattern; "unscoped" when absent. */
  context: string;
  /**
   * 0..1, model-reported EXTRACTION confidence — how clearly the
   * transformation evidences this delta. Explicitly NOT a trait-stability
   * or persona-confidence score; the two must never be conflated when
   * this data is later read.
   */
  confidence: number;
  extractorId: string;
  extractorVersion: string;
  computedAt: string;
}
