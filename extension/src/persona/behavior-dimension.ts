import type { BehaviorDimension, BehaviorDimensionChange, BehaviorDirection } from '@spec/protocol/semantic-revision-judge';

/** Canonical taxonomy — see `training/phase5a/lore/task-contract.v3.md`. Single source of truth for validation. */
export const BEHAVIOR_DIMENSIONS: BehaviorDimension[] = [
  'expressed_affect_valence',
  'expressed_affect_intensity',
  'directness',
  'politeness',
  'formality',
  'certainty',
  'evidentiality',
  'commitment',
  'directive_force',
  'conditionality',
  'scope',
  'specificity',
  'rationale',
  'factual_content',
  'action_or_decision',
];

export const BEHAVIOR_DIRECTIONS: BehaviorDirection[] = [
  'increased',
  'decreased',
  'more_positive',
  'more_negative',
  'added',
  'removed',
  'narrowed',
  'expanded',
  'changed',
];

/**
 * Normative dimension -> allowed-directions mapping (must match
 * `training/phase5a/lore/policy-spec.v1.json` exactly — enforced by
 * `policy-spec-consistency.test.ts`). A direction valid for
 * `BEHAVIOR_DIRECTIONS` generally but not for a given dimension here
 * (e.g. `factual_content -> increased`) is rejected by `isValidDimensionsArray`.
 */
export const CANONICAL_DIMENSION_DIRECTIONS: Readonly<Record<BehaviorDimension, readonly BehaviorDirection[]>> = {
  expressed_affect_valence: ['more_positive', 'more_negative'],
  expressed_affect_intensity: ['increased', 'decreased'],
  directness: ['increased', 'decreased'],
  politeness: ['increased', 'decreased'],
  formality: ['increased', 'decreased'],
  certainty: ['increased', 'decreased'],
  evidentiality: ['changed'],
  commitment: ['increased', 'decreased'],
  directive_force: ['increased', 'decreased'],
  conditionality: ['added', 'removed'],
  scope: ['narrowed', 'expanded'],
  specificity: ['increased', 'decreased'],
  rationale: ['added', 'removed'],
  factual_content: ['changed'],
  action_or_decision: ['changed'],
};

const DIMENSION_SET = new Set<string>(BEHAVIOR_DIMENSIONS);

function isValidBehaviorDimensionChange(value: unknown): value is BehaviorDimensionChange {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as Record<string, unknown>;
  if (typeof change.dimension !== 'string' || !DIMENSION_SET.has(change.dimension)) return false;
  if (typeof change.direction !== 'string') return false;
  const allowedDirections = CANONICAL_DIMENSION_DIRECTIONS[change.dimension as BehaviorDimension];
  return (allowedDirections as readonly string[]).includes(change.direction);
}

/** Renders `CANONICAL_DIMENSION_DIRECTIONS` as `dimension(dir1|dir2), ...` for judge prompts — the single renderer both transports use. */
export function formatCanonicalDimensionDirections(): string {
  return BEHAVIOR_DIMENSIONS.map((dimension) => `${dimension}(${CANONICAL_DIMENSION_DIRECTIONS[dimension].join('|')})`).join(
    ', ',
  );
}

/** Every entry must be a valid {dimension, direction} pair per `CANONICAL_DIMENSION_DIRECTIONS`, with no repeated dimension. Empty array is valid. */
export function isValidDimensionsArray(value: unknown): value is BehaviorDimensionChange[] {
  if (!Array.isArray(value)) return false;
  const seenDimensions = new Set<string>();
  for (const entry of value) {
    if (!isValidBehaviorDimensionChange(entry)) return false;
    if (seenDimensions.has(entry.dimension)) return false;
    seenDimensions.add(entry.dimension);
  }
  return true;
}
