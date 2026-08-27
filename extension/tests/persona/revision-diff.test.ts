import { describe, expect, it } from 'vitest';
import { computeRevisionDiff } from '../../src/persona/revision-diff';

/**
 * Generic, language-independent fixtures only — no Turkish suffixes, no
 * text drawn from the 5 real corpus EditEvents. `computeRevisionDiff`
 * operates on whitespace-delimited tokens only, so single ASCII-letter
 * "words" (A, B, X, Y, ...) exercise the alignment algorithm without
 * implying anything about any particular language.
 */
describe('computeRevisionDiff', () => {
  it('reports no meaningful intervention when ORIGINAL and FINAL are identical', () => {
    const diff = computeRevisionDiff('A B C', 'A B C');
    expect(diff.operations.every((op) => op.kind === 'preserved')).toBe(true);
  });

  it('localizes purely added material', () => {
    const diff = computeRevisionDiff('A B', 'A X B');
    const added = diff.operations.filter((op) => op.kind === 'added');
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((op) => op.finalText.includes('X'))).toBe(true);
    // Added text has no original-side counterpart.
    expect(added.every((op) => op.originalText === '')).toBe(true);
    // Surrounding context is still represented as preserved.
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('A'))).toBe(true);
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('B'))).toBe(true);
  });

  it('localizes purely removed material', () => {
    const diff = computeRevisionDiff('A X B', 'A B');
    const removed = diff.operations.filter((op) => op.kind === 'removed');
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some((op) => op.originalText.includes('X'))).toBe(true);
    expect(removed.every((op) => op.finalText === '')).toBe(true);
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('A'))).toBe(true);
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('B'))).toBe(true);
  });

  it('localizes a replacement, preserving surrounding context', () => {
    const diff = computeRevisionDiff('A X B', 'A Y B');
    const replaced = diff.operations.filter((op) => op.kind === 'replaced');
    expect(replaced.length).toBeGreaterThan(0);
    expect(replaced.some((op) => op.originalText.includes('X') && op.finalText.includes('Y'))).toBe(true);
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('A'))).toBe(true);
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('B'))).toBe(true);
  });

  it('represents a large, substantial rewrite without throwing and without falsely claiming full equivalence', () => {
    const original = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn.';
    const final = 'Completely unrelated content about something else entirely, phrased very differently.';
    const diff = computeRevisionDiff(original, final);
    expect(diff.operations.length).toBeGreaterThan(0);
    // The diff never claims the two texts are fully equivalent — it does
    // not collapse a substantially different text into a single
    // 'preserved' operation covering the whole thing. Incidental shared
    // short tokens (e.g. "the") may still legitimately align as small
    // 'preserved' segments — that is a correct property of the alignment,
    // not fabricated structure.
    expect(diff.operations.some((op) => op.kind !== 'preserved')).toBe(true);
    const wholeTextPreserved = diff.operations.some(
      (op) => op.kind === 'preserved' && op.originalText === original && op.finalText === final,
    );
    expect(wholeTextPreserved).toBe(false);
  });

  it('does not discard a very small textual intervention merely because it is small', () => {
    const diff = computeRevisionDiff('This is a test.', 'This is a test!');
    const nonPreserved = diff.operations.filter((op) => op.kind !== 'preserved');
    expect(nonPreserved.length).toBeGreaterThan(0);
  });

  it('reconstructs the exact ORIGINAL text by concatenating originalText across all operations, in order', () => {
    const cases: [string, string][] = [
      ['A B C', 'A B C'],
      ['A B', 'A X B'],
      ['A X B', 'A B'],
      ['A X B', 'A Y B'],
      ['A X Y B', 'A Y X B'],
      ['This is a test.', 'This is a test!'],
      ['', 'A B'],
      ['A B', ''],
    ];
    for (const [original, final] of cases) {
      const diff = computeRevisionDiff(original, final);
      expect(diff.operations.map((op) => op.originalText).join('')).toBe(original);
    }
  });

  it('reconstructs the exact FINAL text by concatenating finalText across all operations, in order', () => {
    const cases: [string, string][] = [
      ['A B C', 'A B C'],
      ['A B', 'A X B'],
      ['A X B', 'A B'],
      ['A X B', 'A Y B'],
      ['A X Y B', 'A Y X B'],
      ['This is a test.', 'This is a test!'],
      ['', 'A B'],
      ['A B', ''],
    ];
    for (const [original, final] of cases) {
      const diff = computeRevisionDiff(original, final);
      expect(diff.operations.map((op) => op.finalText).join('')).toBe(final);
    }
  });

  it('is purely structural: it never emits any kind other than the five defined operation kinds (no semantic judgment attached to an operation)', () => {
    const diff = computeRevisionDiff('A X B Y C', 'A Z B C');
    const allowedKinds = new Set(['preserved', 'removed', 'added', 'replaced', 'reordered']);
    expect(diff.operations.every((op) => allowedKinds.has(op.kind))).toBe(true);
  });

  it('localizes an adjacent word-level transposition as a single "reordered" operation, per Conijn et al.\'s restricted-Damerau-Levenshtein classification', () => {
    const diff = computeRevisionDiff('A X Y B', 'A Y X B');
    const reordered = diff.operations.filter((op) => op.kind === 'reordered');
    expect(reordered.length).toBe(1);
    expect(reordered[0].originalText).toContain('X');
    expect(reordered[0].originalText).toContain('Y');
    expect(reordered[0].finalText).toContain('X');
    expect(reordered[0].finalText).toContain('Y');
    // Surrounding context still localized as preserved.
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('A'))).toBe(true);
    expect(diff.operations.some((op) => op.kind === 'preserved' && op.originalText.includes('B'))).toBe(true);
    // Reconstruction invariant still holds for the transposition case.
    expect(diff.operations.map((op) => op.originalText).join('')).toBe('A X Y B');
    expect(diff.operations.map((op) => op.finalText).join('')).toBe('A Y X B');
  });

  it('handles empty ORIGINAL (pure addition) and empty FINAL (pure removal)', () => {
    const added = computeRevisionDiff('', 'A B C');
    expect(added.operations.every((op) => op.kind === 'added')).toBe(true);

    const removed = computeRevisionDiff('A B C', '');
    expect(removed.operations.every((op) => op.kind === 'removed')).toBe(true);
  });
});
