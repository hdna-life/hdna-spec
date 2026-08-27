import { describe, expect, it } from 'vitest';
import { computeRevisionDiff } from '../../src/persona/revision-diff';
import { buildRevisionInterventions } from '../../src/persona/revision-intervention';

/**
 * Generic, language-independent fixtures only — no Turkish text, no
 * fixtures drawn from the 5 real corpus EditEvents. See
 * docs/decisions/0016's Trial 3 section.
 */
describe('buildRevisionInterventions', () => {
  it('produces no interventions when ORIGINAL and FINAL are identical', () => {
    const diff = computeRevisionDiff('A B C', 'A B C');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions).toEqual([]);
  });

  it('produces exactly one "added" intervention for a pure addition, with empty originalText', () => {
    const diff = computeRevisionDiff('A B', 'A X B');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions).toHaveLength(1);
    expect(interventions[0].kind).toBe('added');
    expect(interventions[0].originalText).toBe('');
    expect(interventions[0].finalText).toContain('X');
  });

  it('produces exactly one "removed" intervention for a pure removal, with empty finalText', () => {
    const diff = computeRevisionDiff('A X B', 'A B');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions).toHaveLength(1);
    expect(interventions[0].kind).toBe('removed');
    expect(interventions[0].finalText).toBe('');
    expect(interventions[0].originalText).toContain('X');
  });

  it('produces exactly one "replaced" intervention for a substitution', () => {
    const diff = computeRevisionDiff('A X B', 'A Y B');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions).toHaveLength(1);
    expect(interventions[0].kind).toBe('replaced');
    expect(interventions[0].originalText).toContain('X');
    expect(interventions[0].finalText).toContain('Y');
  });

  it('produces exactly one "reordered" intervention for an adjacent transposition', () => {
    const diff = computeRevisionDiff('A X Y B', 'A Y X B');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions).toHaveLength(1);
    expect(interventions[0].kind).toBe('reordered');
  });

  it('never emits a "preserved" intervention', () => {
    const diff = computeRevisionDiff('The AAA text BBB stays mostly the same', 'The CCC text BBB stays mostly the same');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions.every((i) => (i.kind as string) !== 'preserved')).toBe(true);
  });

  it('produces multiple, independently traceable interventions for multiple separated edits', () => {
    const diff = computeRevisionDiff('A X B Y C', 'A Z B W C');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    expect(interventions.length).toBeGreaterThanOrEqual(2);
    const ids = interventions.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of interventions) {
      expect(i.sourceEvidenceId).toBe('edit_event:e1');
      expect(i.id.startsWith('edit_event:e1#')).toBe(true);
    }
  });

  it('gives adjacent preserved spans as beforeContext/afterContext, not as their own intervention', () => {
    const diff = computeRevisionDiff('Alpha Bravo Charlie', 'Alpha Delta Charlie');
    const interventions = buildRevisionInterventions('edit_event:e1', diff);
    const replaced = interventions.find((i) => i.kind === 'replaced');
    expect(replaced).toBeDefined();
    expect(replaced!.beforeContext).toContain('Alpha');
    expect(replaced!.afterContext).toContain('Charlie');
  });

  it('provenance: ids are deterministic and reproducible for the same input', () => {
    const diff1 = computeRevisionDiff('A X B Y C', 'A Z B W C');
    const diff2 = computeRevisionDiff('A X B Y C', 'A Z B W C');
    const ids1 = buildRevisionInterventions('edit_event:e1', diff1).map((i) => i.id);
    const ids2 = buildRevisionInterventions('edit_event:e1', diff2).map((i) => i.id);
    expect(ids1).toEqual(ids2);
  });
});
