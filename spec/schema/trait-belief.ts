/**
 * A higher-level personality/worldview claim — the design doc's
 * TRAITS/BELIEFS canonical layer, one step above PATTERNS (see
 * spec/schema/pattern.ts, docs/decisions/0011). Produced only by T3 ("rare
 * persona-model interpretation") over already-thresholded Patterns, never
 * from raw evidence directly.
 *
 * Every claim must reference the Patterns that support it and never be
 * inferred from a single observation — see docs/decisions/0015.
 * Fully rebuildable from PatternStore at any time, so this is DERIVED, not
 * a canonical fact about the person.
 */
export interface TraitBeliefClaim {
  id: string;
  /** e.g. "prioritizes implementation simplicity". */
  claim: string;
  /** Context bucket, same convention as Pattern.context ("unscoped" when none). */
  context: string;
  /** 0..1, model-reported. Conservative by construction — see PersonaInterpreterPolicy. */
  confidence: number;
  /** "dimension:context" keys into PatternStore. Required, never empty. */
  supportingPatternKeys: string[];
  /** e.g. "openrouter". */
  interpreterId: string;
  /** The actual model id used for this claim, for provenance. */
  interpreterModelId: string;
  computedAt: string;
}
