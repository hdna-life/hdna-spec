import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEHAVIOR_DIMENSIONS, BEHAVIOR_DIRECTIONS } from '../../src/persona/behavior-dimension';

/**
 * Deterministic consistency check between the two active sources of truth
 * for the localized edit-judgment policy:
 *
 * 1. `training/phase5a/lore/task-contract.v3.md` — the human-authored
 *    canonical contract (productization cleanup, see this repo's history).
 * 2. `training/phase5a/lore/policy-spec.v1.json` — its machine-readable
 *    counterpart, for future Test 2 generator/verifier/runtime tooling.
 *
 * Both must agree exactly with each other AND with the actual runtime
 * closed sets this codebase already validates against
 * (`behavior-dimension.ts`'s `BEHAVIOR_DIMENSIONS`/`BEHAVIOR_DIRECTIONS`) —
 * so a future edit to any one of the three can never silently drift out of
 * sync with the other two. Deliberately does NOT assert that runtime
 * validation enforces the policy JSON's narrower per-dimension direction
 * mapping (`isValidDimensionsArray` only checks flat set membership, by
 * design — see that module's own docstring) — this test is a documentation/
 * policy-consistency check, not a claim that evaluation code changed.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CONTRACT_PATH = path.join(REPO_ROOT, 'training/phase5a/lore/task-contract.v3.md');
const POLICY_SPEC_PATH = path.join(REPO_ROOT, 'training/phase5a/lore/policy-spec.v1.json');

interface PolicySpec {
  version: string;
  verdicts: string[];
  dimensions: Record<string, string[]>;
  rules: string[];
}

function loadPolicySpec(): PolicySpec {
  return JSON.parse(readFileSync(POLICY_SPEC_PATH, 'utf-8'));
}

/** Extracts the §3.2 "canonical dimension→direction mapping" Markdown table into a plain object, in document order. */
function extractContractDimensionTable(markdown: string): Record<string, string[]> {
  const tableSection = markdown.split('### 3.2. The canonical dimension')[1]?.split('### 3.3.')[0];
  if (!tableSection) throw new Error('Could not locate the §3.2 dimension→direction table in task-contract.v3.md');

  const rowPattern = /^\|\s*`([a-z_]+)`\s*\|\s*(.+?)\s*\|\s*$/gm;
  const result: Record<string, string[]> = {};
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(tableSection)) !== null) {
    const [, dimension, directionsCell] = match;
    const directions = directionsCell
      .split(',')
      .map((d) => d.trim().replace(/^`|`$/g, ''))
      .filter((d) => d.length > 0);
    result[dimension] = directions;
  }
  return result;
}

/** Extracts the §1 output-shape `verdict:` line's five quoted values, in document order. */
function extractContractVerdicts(markdown: string): string[] {
  const match = markdown.match(
    /verdict:\s+'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'\s*\n\s*\|?\s*'([^']+)'\s*\|\s*'([^']+)'/,
  );
  if (!match) throw new Error('Could not locate the §1 verdict enum line in task-contract.v3.md');
  return match.slice(1, 6);
}

describe('policy-spec.v1.json <-> task-contract.v3.md consistency', () => {
  const markdown = readFileSync(CONTRACT_PATH, 'utf-8');
  const policySpec = loadPolicySpec();

  it('verdicts match exactly between the JSON and the Markdown contract', () => {
    const contractVerdicts = extractContractVerdicts(markdown);
    expect(policySpec.verdicts).toEqual(contractVerdicts);
  });

  it('dimension keys and their allowed directions match exactly between the JSON and the Markdown contract', () => {
    const contractTable = extractContractDimensionTable(markdown);
    expect(policySpec.dimensions).toEqual(contractTable);
  });

  it('has exactly 15 dimensions, matching the runtime closed taxonomy count', () => {
    expect(Object.keys(policySpec.dimensions)).toHaveLength(15);
  });
});

describe('policy-spec.v1.json <-> runtime closed sets consistency', () => {
  const policySpec = loadPolicySpec();

  it('dimension keys match BEHAVIOR_DIMENSIONS exactly, same order', () => {
    expect(Object.keys(policySpec.dimensions)).toEqual(BEHAVIOR_DIMENSIONS);
  });

  it('every allowed direction for every dimension is a member of the runtime BEHAVIOR_DIRECTIONS set', () => {
    const runtimeDirections = new Set<string>(BEHAVIOR_DIRECTIONS);
    for (const [dimension, directions] of Object.entries(policySpec.dimensions)) {
      for (const direction of directions) {
        expect(runtimeDirections.has(direction), `${dimension} -> ${direction} is not a recognized direction value`).toBe(true);
      }
    }
  });

  it('every runtime direction value is used by at least one dimension in the policy spec (no orphaned direction)', () => {
    const usedDirections = new Set(Object.values(policySpec.dimensions).flat());
    for (const direction of BEHAVIOR_DIRECTIONS) {
      expect(usedDirections.has(direction), `${direction} is not assigned to any dimension in policy-spec.v1.json`).toBe(true);
    }
  });

  it('no dimension has zero allowed directions', () => {
    for (const [dimension, directions] of Object.entries(policySpec.dimensions)) {
      expect(directions.length, `${dimension} has no allowed directions`).toBeGreaterThan(0);
    }
  });

  it('the five canonical verdicts are exactly no_meaningful_change/meaning_added/meaning_removed/meaning_transformed/uncertain', () => {
    expect(policySpec.verdicts).toEqual([
      'no_meaningful_change',
      'meaning_added',
      'meaning_removed',
      'meaning_transformed',
      'uncertain',
    ]);
  });
});
