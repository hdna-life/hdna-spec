/**
 * Deterministic textual revision localization — Trial 2's evidence-
 * localization layer (docs/decisions/0016's Trial 2 section). Purely
 * structural: it identifies WHERE the ORIGINAL and FINAL text differ,
 * never WHAT the difference means semantically. TEXTUAL DIFF != SEMANTIC
 * DELTA — a tiny textual edit can carry a large semantic effect, and a
 * large rewrite can preserve essentially the same meaning; semantic
 * interpretation remains the LLM extractor's job, not this module's (see
 * `openrouter-semantic-delta-extractor.ts`'s prompt, which states this
 * boundary explicitly to the model).
 *
 * ALGORITHM — restricted Damerau-Levenshtein (optimal string alignment,
 * OSA) token alignment, adapted from the automatic revision-classification
 * method in Conijn, Kleinberg & van den Bosch, "A Product- and
 * Process-Oriented Tagset for Revisions in Writing" (2022): they classify
 * insertion, deletion, substitution, and (adjacent) reordering using
 * restricted Damerau-Levenshtein distance below word level. This module
 * runs the direct word/whitespace-token-level analogue: standard
 * Levenshtein insert/delete/substitute costs, plus one additional
 * transposition case (swapping two immediately adjacent tokens costs the
 * same as a single edit) — the "restricted" variant, meaning a
 * transposition only ever consumes two adjacent, not-otherwise-edited
 * tokens, exactly as OSA distance requires. This is the smallest
 * unambiguous algorithm that reproduces Conijn et al.'s four operation
 * classes (here: preserved/removed/added/replaced/reordered) at the
 * token level, without adding a dependency or inventing an ad-hoc
 * heuristic tuned to any particular corpus.
 *
 * Spangher et al.'s NewsEdits (multilingual document-revision alignment
 * across full news articles, sentence/document granularity) was reviewed
 * as related work but is not the algorithm adapted here: NewsEdits solves
 * cross-version article alignment at a much larger granularity than a
 * single AI-draft/human-edit sentence-or-paragraph pair, and depends on
 * article-level structure this codebase's `EditEvent`s do not have. For
 * HDNA's short `EditEvent` pairs, Conijn et al.'s word-below-level
 * restricted-Damerau-Levenshtein classification is the smaller, better-
 * fitting method — see docs/decisions/0016's Trial 2 "Academic connection"
 * section for the full citation-by-citation treatment of what each source
 * does and does not establish.
 *
 * Operates only on whitespace-delimited token boundaries. It has no
 * knowledge of any particular language's word/morpheme/grammar structure
 * — no suffix lists, no morphology tables, no per-language tokenizer. The
 * same alignment algorithm runs identically regardless of the input
 * language.
 *
 * This is an experimental extractor-support representation, not canonical
 * persona evidence and not a new persistence schema — nothing here is
 * stored; `SemanticDeltaExtractionService` never persists a `RevisionDiff`,
 * only the `SemanticDeltaCandidate`s the LLM extractor derives with it as
 * additional context.
 */

export type RevisionOperationKind = 'preserved' | 'removed' | 'added' | 'replaced' | 'reordered';

export interface RevisionOperation {
  kind: RevisionOperationKind;
  originalText: string;
  finalText: string;
}

export interface RevisionDiff {
  operations: RevisionOperation[];
}

/**
 * Splits into tokens of "optional leading whitespace + one whitespace-free
 * run" (plus a final whitespace-only token if the text ends in
 * whitespace), so every token reconstructs its exact source substring —
 * `operations.map(o => o.originalText).join('')` always equals the
 * original input, and likewise for `finalText` — AND, critically, so two
 * neighboring *words* are directly adjacent array elements even though a
 * whitespace run sits between them in the source text. That adjacency is
 * what lets `alignTokens`'s restricted-transposition case (immediately
 * adjacent array elements only, per Conijn et al.'s OSA-based method — see
 * this module's top-level docstring) actually detect a genuine two-word
 * swap, rather than only ever seeing an isolated whitespace token wedged
 * between two "distant" words. This is still generic whitespace
 * segmentation, not word/morpheme tokenization specific to any language —
 * it works the same way for any whitespace-delimited text and encodes no
 * per-language knowledge.
 */
function tokenize(text: string): string[] {
  return text.match(/\s*\S+|\s+$/g) ?? [];
}

// Restricted-Damerau-Levenshtein DP is O(n*m), fine for edit-event-sized
// text (sentences/short paragraphs). For unusually large inputs, skip the
// DP entirely and report the whole text as one 'replaced' operation
// rather than pay an unbounded cost — a size-based safety fallback, not a
// language- or content-specific rule.
const MAX_DP_CELLS = 250_000;

type EditOp = { type: 'equal' | 'delete' | 'insert' | 'substitute'; original?: string; final?: string } | {
  type: 'transpose';
  original: [string, string];
  final: [string, string];
};

/**
 * Restricted Damerau-Levenshtein (OSA) token alignment: standard
 * insert/delete/substitute edit costs (1 each, 0 for an exact match),
 * plus a transposition of two immediately adjacent tokens at cost 1 — the
 * "restricted" constraint means a transposed pair is never itself further
 * edited, matching OSA distance's definition and Conijn et al.'s
 * word-below-level classification method.
 */
function alignTokens(originalTokens: string[], finalTokens: string[]): EditOp[] {
  const n = originalTokens.length;
  const m = finalTokens.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const substitutionCost = originalTokens[i - 1] === finalTokens[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + substitutionCost, // match / substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        originalTokens[i - 1] === finalTokens[j - 2] &&
        originalTokens[i - 2] === finalTokens[j - 1]
      ) {
        best = Math.min(best, d[i - 2][j - 2] + 1); // adjacent transposition
      }
      d[i][j] = best;
    }
  }

  // Backtrack from (n, m) to (0, 0), preferring (in order) an exact
  // match, then a transposition, then a substitution, then a
  // deletion/insertion — any choice consistent with the DP values yields
  // a valid minimum-cost alignment; this priority order simply avoids
  // reporting a spurious delete+insert pair when a single substitution or
  // transposition already explains the same cost.
  const ops: EditOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalTokens[i - 1] === finalTokens[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ type: 'equal', original: originalTokens[i - 1], final: finalTokens[j - 1] });
      i--;
      j--;
      continue;
    }
    if (
      i > 1 &&
      j > 1 &&
      originalTokens[i - 1] === finalTokens[j - 2] &&
      originalTokens[i - 2] === finalTokens[j - 1] &&
      d[i][j] === d[i - 2][j - 2] + 1
    ) {
      ops.push({
        type: 'transpose',
        original: [originalTokens[i - 2], originalTokens[i - 1]],
        final: [finalTokens[j - 2], finalTokens[j - 1]],
      });
      i -= 2;
      j -= 2;
      continue;
    }
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (originalTokens[i - 1] === finalTokens[j - 1] ? 0 : 1)) {
      ops.push({ type: 'substitute', original: originalTokens[i - 1], final: finalTokens[j - 1] });
      i--;
      j--;
      continue;
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: 'delete', original: originalTokens[i - 1] });
      i--;
      continue;
    }
    // j > 0 && d[i][j] === d[i][j - 1] + 1
    ops.push({ type: 'insert', final: finalTokens[j - 1] });
    j--;
  }
  ops.reverse();
  return ops;
}

interface RunSegment {
  kind: RevisionOperationKind;
  originalText: string;
  finalText: string;
}

function runLengthEncode(ops: EditOp[]): RunSegment[] {
  const segments: RunSegment[] = [];
  for (const op of ops) {
    let kind: RevisionOperationKind;
    let originalPart: string;
    let finalPart: string;
    switch (op.type) {
      case 'equal':
        kind = 'preserved';
        originalPart = op.original ?? '';
        finalPart = op.final ?? '';
        break;
      case 'delete':
        kind = 'removed';
        originalPart = op.original ?? '';
        finalPart = '';
        break;
      case 'insert':
        kind = 'added';
        originalPart = '';
        finalPart = op.final ?? '';
        break;
      case 'substitute':
        kind = 'replaced';
        originalPart = op.original ?? '';
        finalPart = op.final ?? '';
        break;
      case 'transpose':
        kind = 'reordered';
        originalPart = op.original.join('');
        finalPart = op.final.join('');
        break;
    }

    const last = segments[segments.length - 1];
    // Merge with the previous segment only when it is the exact same kind
    // AND the merge is a simple in-order continuation (transposition
    // segments are never merged with neighbors — each one is a discrete,
    // two-token structural event, not a run to extend).
    if (last && last.kind === kind && kind !== 'reordered') {
      last.originalText += originalPart;
      last.finalText += finalPart;
    } else {
      segments.push({ kind, originalText: originalPart, finalText: finalPart });
    }
  }

  // A same-cost tie in the DP can still occasionally resolve to an
  // adjacent delete run immediately followed by an insert run (or vice
  // versa) instead of a substitution — collapse that into a single
  // 'replaced' segment too, so the reported operation set never depends
  // on which of two equal-cost backtrack paths was taken.
  const merged: RunSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current.kind === 'removed' && next?.kind === 'added') {
      merged.push({ kind: 'replaced', originalText: current.originalText, finalText: next.finalText });
      i++;
      continue;
    }
    if (current.kind === 'added' && next?.kind === 'removed') {
      merged.push({ kind: 'replaced', originalText: next.originalText, finalText: current.finalText });
      i++;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

/**
 * Computes a deterministic, language-general revision diff between
 * ORIGINAL and FINAL text using restricted Damerau-Levenshtein (OSA)
 * token alignment — see this module's top-level docstring for the
 * algorithm and its academic basis.
 */
export function computeRevisionDiff(originalText: string, finalText: string): RevisionDiff {
  const originalTokens = tokenize(originalText);
  const finalTokens = tokenize(finalText);

  if (originalTokens.length * finalTokens.length > MAX_DP_CELLS) {
    return { operations: [{ kind: 'replaced', originalText, finalText }] };
  }

  const segments = runLengthEncode(alignTokens(originalTokens, finalTokens));
  return {
    operations: segments.map((segment) => ({
      kind: segment.kind,
      originalText: segment.originalText,
      finalText: segment.finalText,
    })),
  };
}
