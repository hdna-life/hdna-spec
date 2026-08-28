/**
 * Trial 3's narrow semantic-judge contract (docs/decisions/0016's Trial 3
 * section) — deliberately much smaller than
 * `spec/protocol/semantic-delta-extractor.ts`'s `SemanticDeltaExtractorProvider`.
 * Where Trial 0-2's provider is handed a whole EditEvent (ORIGINAL + FINAL)
 * and asked to discover, localize, and interpret an arbitrary number of
 * semantic deltas in one call, this provider is handed exactly one
 * deterministically-localized `RevisionIntervention`
 * (`extension/src/persona/revision-intervention.ts`) and asked only:
 * "does this one localized change carry a directly observable semantic
 * effect, and if so, what is it?" This is the contract a WebGPU-scale
 * small model is expected to be able to satisfy; discovering boundaries,
 * deduplicating, and deciding persona relevance remain deterministic HDNA
 * responsibilities (see `extension/src/persona/revision-intervention.ts`,
 * `semantic-revision-admission.ts`, `semantic-revision-judge-extraction-service.ts`).
 *
 * `'preserved'` is deliberately excluded from `RevisionInterventionKind`:
 * purely preserved regions are never sent to this provider as independent
 * units (docs/decisions/0016 Trial 3 §5.3) — they may only appear as
 * `beforeContext`/`afterContext` on a real intervention.
 */
export type RevisionInterventionKind = 'added' | 'removed' | 'replaced' | 'reordered';

export interface SemanticRevisionJudgeInput {
  kind: RevisionInterventionKind;
  originalText: string;
  finalText: string;
  /** Short trailing excerpt of the nearest preceding preserved span, or '' if none. Context only — never itself a judgeable unit. */
  beforeContext: string;
  /** Short leading excerpt of the nearest following preserved span, or '' if none. Context only — never itself a judgeable unit. */
  afterContext: string;
}

/**
 * Deliberately five values, not a persona taxonomy — describes the
 * relation between the localized textual intervention and its meaning,
 * never the person. `'uncertain'` and `'no_meaningful_change'` are both
 * valid, expected outcomes, not failures — abstention is a first-class
 * result (same discipline as Trial 0-2's empty-candidates-array
 * abstention). See docs/decisions/0016's Trial 3 §7.
 */
export type SemanticChangeVerdict =
  | 'no_meaningful_change'
  | 'meaning_added'
  | 'meaning_removed'
  | 'meaning_transformed'
  | 'uncertain';

/**
 * Test 1's second, orthogonal output axis (docs/decisions/0017's
 * "SEMANTIC/PRACTICAL vs. OBSERVABLE BEHAVIOR axes" addendum). Deliberately
 * NOT a sixth `SemanticChangeVerdict` value — `verdict` answers "what
 * happened to the proposition/practical meaning?"; a `BehaviorDimension`
 * answers "how did the observable expression/stance change?" The two axes
 * are independent: a `'no_meaningful_change'` verdict may carry one or
 * more dimensions (a same-topic tone/stance shift), and
 * `meaning_added`/`meaning_removed`/`meaning_transformed` may ALSO carry
 * dimensions (a semantic change is very often accompanied by an expression
 * change, e.g. "Maybe I'll come." -> "I will come." is both
 * `meaning_transformed` AND `certainty: increased` + `commitment:
 * increased`).
 *
 * A small, closed, versioned taxonomy for Test 1 — not a general ontology.
 * Every dimension name is `expressed_*`/observable-textual-stance framed
 * (never `emotion`, `mood`, or any hidden-psychology term) because the
 * judge may only describe directly observable changes in EXPRESSED
 * behavior, never infer the human's actual internal emotional/
 * psychological state — see `training/phase5a/lore/task-contract.v3.md`
 * for the full rationale and worked examples this taxonomy is grounded in.
 */
export type BehaviorDimension =
  | 'expressed_affect_valence'
  | 'expressed_affect_intensity'
  | 'directness'
  | 'politeness'
  | 'formality'
  | 'certainty'
  | 'evidentiality'
  | 'commitment'
  | 'directive_force'
  | 'conditionality'
  | 'scope'
  | 'specificity'
  | 'rationale'
  | 'factual_content'
  | 'action_or_decision';

/**
 * Direction/change value for one `BehaviorDimensionChange`. Not every
 * direction is a sensible pairing for every dimension (e.g.
 * `expressed_affect_valence` pairs with `more_positive`/`more_negative`,
 * not `increased`/`decreased`) — the sensible combinations are documented
 * in `training/phase5a/lore/task-contract.v3.md`, not enforced here as a
 * closed per-dimension mapping, to avoid building a rigid ontology
 * platform for a first Test 1 pass.
 */
export type BehaviorDirection =
  | 'increased'
  | 'decreased'
  | 'more_positive'
  | 'more_negative'
  | 'added'
  | 'removed'
  | 'narrowed'
  | 'expanded'
  | 'changed';

/** One observed shift on one dimension. A judgment's `dimensions` array must never contain two entries with the same `dimension` (see `validateJudgmentDraft`/`extension/src/persona/semantic-revision-judge-wire.ts`). */
export interface BehaviorDimensionChange {
  dimension: BehaviorDimension;
  direction: BehaviorDirection;
}

/**
 * A single narrow semantic judgment, before HDNA's deterministic admission
 * gate (`extension/src/persona/semantic-revision-admission.ts`) decides
 * whether it becomes persona evidence. `description` is `null` whenever no
 * semantic change is claimed (`'no_meaningful_change'`/`'uncertain'`) —
 * required (not optional) so a strict-schema OpenAI/Azure-compatible
 * provider can express "not applicable" without an unsupported optional
 * JSON Schema property, same wire-vs-domain discipline
 * `openrouter-semantic-delta-extractor.ts` already established for
 * `preferred`/`rejected` (docs/decisions/0016's "Post-implementation fix"
 * section) — reused here rather than reinvented. `description` is
 * secondary to the structured `verdict`/`dimensions` pair (Test 1's
 * addendum) — it is never used as training ground truth on its own; see
 * `training/phase5a/dataset/split_dataset.py`.
 *
 * `dimensions` is always an array (never omitted/undefined) — empty is a
 * valid, meaningful answer ("no observable behavioral shift"), not "not
 * asked." Per Test 1's rules: `'uncertain'` MUST have `dimensions: []`
 * (kept simple for this first pass — no uncertain-with-dimensions case
 * yet); every other verdict MAY have zero, one, or several dimensions, and
 * a dimension may never repeat within one judgment.
 */
export interface SemanticRevisionJudgmentDraft {
  verdict: SemanticChangeVerdict;
  dimensions: BehaviorDimensionChange[];
  description: string | null;
  confidence: number;
}

/**
 * Provider-agnostic Trial 3 contract, mirroring
 * `SemanticDeltaExtractorProvider`/`EmbeddingProvider`/`TinyClassifier`'s
 * shape: no fetch/API-key/HTTP concept here. One call judges exactly one
 * intervention — never a whole EditEvent, never an arbitrary candidate
 * set. See docs/decisions/0016's Trial 3 section.
 */
export interface SemanticRevisionJudgeProvider {
  readonly providerId: string;
  readonly modelId: string;
  judge(input: SemanticRevisionJudgeInput): Promise<SemanticRevisionJudgmentDraft>;
}
