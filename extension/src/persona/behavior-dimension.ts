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

/**
 * **Normative** canonical dimension -> allowed-directions mapping —
 * `training/phase5a/lore/task-contract.v3.md` §3.2 and its machine-readable
 * counterpart `training/phase5a/lore/policy-spec.v1.json` (kept in exact
 * agreement, cross-checked by
 * `extension/tests/persona/policy-spec-consistency.test.ts`). This is the
 * single source of truth for which `{dimension, direction}` pairs are
 * valid — every prompt builder and every validator in this codebase (local
 * MLX, OpenRouter, the Dashboard's ground-truth entry UI) must render/
 * enforce from this mapping, never a second hand-maintained copy.
 *
 * A pair whose `direction` is a member of `BEHAVIOR_DIRECTIONS` generally
 * but not of *this specific dimension's* allowed set (e.g.
 * `factual_content -> increased`, `conditionality -> increased`,
 * `politeness -> changed`) is invalid and must be rejected —
 * `isValidDimensionsArray` enforces this below.
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

/**
 * Renders `CANONICAL_DIMENSION_DIRECTIONS` as a compact
 * `dimension(dir1|dir2)` line for embedding directly in a judge prompt —
 * the single renderer both `buildNarrowJudgePrompt`
 * (`semantic-revision-judge-wire.ts`, local MLX transport) and
 * `OpenRouterSemanticRevisionJudge`'s prompt use, so the prompt text can
 * never hand-duplicate (and drift from) this mapping.
 */
export function formatCanonicalDimensionDirections(): string {
  return BEHAVIOR_DIMENSIONS.map((dimension) => `${dimension}(${CANONICAL_DIMENSION_DIRECTIONS[dimension].join('|')})`).join(
    ', ',
  );
}

/**
 * Validates a `dimensions` array: must be an array, every element must be
 * a well-formed `BehaviorDimensionChange` (known dimension + known
 * direction, and that direction must be one of THIS dimension's
 * canonically allowed directions per `CANONICAL_DIMENSION_DIRECTIONS` —
 * not merely a member of `BEHAVIOR_DIRECTIONS` in general), and no
 * `dimension` may repeat within the array. An empty array is always
 * valid — it means "no observable behavioral shift asserted," a
 * legitimate answer, not a malformed one.
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
