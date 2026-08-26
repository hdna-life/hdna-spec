/**
 * The deterministic evidence-threshold trigger for T3 interpretation — the
 * design doc's "an LLM call is triggered by a deterministic evidence
 * threshold... if not sufficient, no semantic trait inference happens."
 *
 * Per-pattern sample/confidence thresholds are already enforced one layer
 * down by PatternCompilerPolicy (PatternStore only ever holds
 * already-thresholded Patterns), so this policy only gates on having enough
 * *distinct* patterns to interpret — not a duplicate of 0011's threshold.
 */
export interface PersonaInterpreterPolicy {
  minPatternCount: number;
}

export const DEFAULT_PERSONA_INTERPRETER_POLICY: PersonaInterpreterPolicy = {
  minPatternCount: 2,
};
