import type { RevisionInterventionKind } from '@spec/protocol/semantic-revision-judge';
import type { RevisionDiff } from './revision-diff';

/**
 * Trial 3's deterministic intervention-unit representation
 * (docs/decisions/0016's Trial 3 section) — a single localized human
 * textual intervention, built from Trial 2's `RevisionDiff`
 * (`revision-diff.ts`, reused unchanged) by dropping every `'preserved'`
 * operation and keeping the rest as independently traceable units. This is
 * the smallest repository-consistent representation the small semantic
 * judge is handed one at a time — not canonical persona evidence, and not
 * a new persistence schema; nothing here is stored (mirrors
 * `RevisionDiff`'s own "experimental extractor-support representation"
 * discipline).
 *
 * Every field is HDNA-computed. The small model never sees, generates, or
 * is asked to reconstruct `id`/`sourceEvidenceId` — it only ever receives
 * `kind`/`originalText`/`finalText`/`beforeContext`/`afterContext` via
 * `SemanticRevisionJudgeInput` (`@spec/protocol/semantic-revision-judge`).
 */
export interface RevisionIntervention {
  /** Deterministic, HDNA-generated: `${sourceEvidenceId}#<index>`, stable for a given (sourceEvidenceId, diff) pair — never model-generated. */
  id: string;
  sourceEvidenceId: string;
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  /** Trailing excerpt of the nearest preceding preserved span, or '' if none/too far. Context only, not itself a judgeable unit. */
  beforeContext: string;
  /** Leading excerpt of the nearest following preserved span, or '' if none/too far. Context only, not itself a judgeable unit. */
  afterContext: string;
}

// Bounds how much surrounding preserved text is shown to the judge model,
// per Trial 3's "keep context minimal" cost discipline (§15) — a
// size-based limit, not a language- or content-specific rule.
const CONTEXT_CHAR_LIMIT = 80;

function trailingExcerpt(text: string): string {
  return text.length <= CONTEXT_CHAR_LIMIT ? text : text.slice(text.length - CONTEXT_CHAR_LIMIT);
}

function leadingExcerpt(text: string): string {
  return text.length <= CONTEXT_CHAR_LIMIT ? text : text.slice(0, CONTEXT_CHAR_LIMIT);
}

/**
 * Builds the ordered list of `RevisionIntervention`s for one EditEvent's
 * `RevisionDiff`. Purely structural — no semantic judgment, no model call,
 * no persistence. `'preserved'` operations never become an intervention
 * (docs/decisions/0016 Trial 3 §5.3: preserved-only regions are not
 * evidence); an immediately-adjacent `'preserved'` operation instead
 * contributes `beforeContext`/`afterContext` to its non-preserved
 * neighbor(s).
 */
export function buildRevisionInterventions(sourceEvidenceId: string, diff: RevisionDiff): RevisionIntervention[] {
  const interventions: RevisionIntervention[] = [];
  let index = 0;
  for (let i = 0; i < diff.operations.length; i++) {
    const op = diff.operations[i];
    if (op.kind === 'preserved') continue;

    const before = diff.operations[i - 1];
    const after = diff.operations[i + 1];

    interventions.push({
      id: `${sourceEvidenceId}#${index}`,
      sourceEvidenceId,
      kind: op.kind,
      originalText: op.originalText,
      finalText: op.finalText,
      beforeContext: before?.kind === 'preserved' ? trailingExcerpt(before.originalText) : '',
      afterContext: after?.kind === 'preserved' ? leadingExcerpt(after.originalText) : '',
    });
    index += 1;
  }
  return interventions;
}
