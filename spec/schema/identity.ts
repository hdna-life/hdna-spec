/**
 * Typed identity facts (objective/explicit information), per the design doc's
 * FACTS canonical layer. Placeholder shape only — no capture/population logic
 * exists in the MVP foundation; this exists so downstream schema (Expression
 * Sheet, evidence graph) has a stable type to reference.
 */
export interface IdentityFact<T = unknown> {
  key: string;
  value: T;
  /** ISO timestamp of when this fact was recorded/confirmed. */
  recordedAt: string;
}

export interface IdentityFacts {
  facts: IdentityFact[];
}
