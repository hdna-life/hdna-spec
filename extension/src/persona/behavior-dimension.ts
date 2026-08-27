import type { BehaviorDimension, BehaviorDimensionChange, BehaviorDirection } from '@spec/protocol/semantic-revision-judge';

/**
 * Test 1's closed dimension/direction taxonomy (docs/decisions/0017's
 * "structured behavioral dimensions" addendum;
 * `training/phase5a/lore/task-contract.v3.md`). Single source of truth for
 * validation — reused by the shared wire parser
 * (`semantic-revision-judge-wire.ts`), Trial 3's admission-time draft
 * validator (`semantic-revision-judgment.ts`), and the OpenRouter provider's
 * own JSON-Schema-adjacent wire check (`openrouter-semantic-revision-judge.ts`),
 * so the "no duplicate dimensions, only these dimension/direction values"
 * rule is defined once, not reimplemented per call site.
 */
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

const DIMENSION_SET = new Set<string>(BEHAVIOR_DIMENSIONS);
const DIRECTION_SET = new Set<string>(BEHAVIOR_DIRECTIONS);

function isValidBehaviorDimensionChange(value: unknown): value is BehaviorDimensionChange {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as Record<string, unknown>;
  if (typeof change.dimension !== 'string' || !DIMENSION_SET.has(change.dimension)) return false;
  if (typeof change.direction !== 'string' || !DIRECTION_SET.has(change.direction)) return false;
  return true;
}

/**
 * Validates a `dimensions` array: must be an array, every element must be
 * a well-formed `BehaviorDimensionChange` (known dimension + known
 * direction), and no `dimension` may repeat within the array. An empty
 * array is always valid — it means "no observable behavioral shift
 * asserted," a legitimate answer, not a malformed one.
 */
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
