import type { BehaviorDimension, BehaviorDimensionChange, BehaviorDirection, SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
import type { Trial4ExclusionReason, Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';

/** Turkish display labels for the 15 observable-behavior dimensions (Test 1 / v3 addendum), in the review UI's grouped display order. */
export const DIMENSION_LABELS_TR: Record<BehaviorDimension, string> = {
  expressed_affect_valence: 'Duygu yönü',
  expressed_affect_intensity: 'Duygu şiddeti',
  directness: 'Doğrudanlık',
  politeness: 'Nezaket',
  formality: 'Resmiyet',
  certainty: 'Kesinlik',
  evidentiality: 'Kanıtsal ifade',
  commitment: 'Taahhüt',
  directive_force: 'Yönlendirme gücü',
  conditionality: 'Koşul',
  scope: 'Kapsam',
  specificity: 'Özgüllük',
  rationale: 'Gerekçe',
  factual_content: 'Olgusal içerik',
  action_or_decision: 'Eylem / karar',
};

/** Turkish display labels for the 9 direction values (Test 1 / v3 addendum). */
export const DIRECTION_LABELS_TR: Record<BehaviorDirection, string> = {
  increased: 'Arttı',
  decreased: 'Azaldı',
  more_positive: 'Daha olumlu',
  more_negative: 'Daha olumsuz',
  added: 'Eklendi',
  removed: 'Çıkarıldı',
  narrowed: 'Daraldı',
  expanded: 'Genişledi',
  changed: 'Değişti',
};

export const DIRECTION_ORDER: BehaviorDirection[] = [
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
 * "NE DEĞİŞTİ?" review UI's three dimension groups (Test 1 / v3 addendum) —
 * purely a display grouping, not part of the persisted schema.
 */
export const DIMENSION_GROUPS_TR: { label: string; dimensions: BehaviorDimension[] }[] = [
  {
    label: 'İfade / ton',
    dimensions: ['expressed_affect_valence', 'expressed_affect_intensity', 'directness', 'politeness', 'formality'],
  },
  {
    label: 'Duruş',
    dimensions: ['certainty', 'evidentiality', 'commitment', 'directive_force'],
  },
  {
    label: 'Anlam / pratik içerik',
    dimensions: ['conditionality', 'scope', 'specificity', 'rationale', 'factual_content', 'action_or_decision'],
  },
];

/** Order-independent set equality over (dimension, direction) pairs — same comparison as `trial4-benchmark-stats.ts`'s dimension accuracy metric, kept as its own small copy here rather than a shared import (this module has no other dependency on the benchmark stats module). */
function dimensionSetsEqual(a: BehaviorDimensionChange[], b: BehaviorDimensionChange[]): boolean {
  if (a.length !== b.length) return false;
  const aKeys = new Set(a.map((d) => `${d.dimension}:${d.direction}`));
  const bKeys = new Set(b.map((d) => `${d.dimension}:${d.direction}`));
  if (aKeys.size !== bKeys.size) return false;
  for (const key of aKeys) if (!bKeys.has(key)) return false;
  return true;
}

/** Turkish display labels for the five verdict values, in the fixed order the review UI presents them (docs/decisions/0017's structured-decisions addendum). */
export const VERDICT_LABELS_TR: Record<SemanticChangeVerdict, string> = {
  meaning_added: 'Anlam eklendi',
  meaning_removed: 'Anlam çıkarıldı',
  meaning_transformed: 'Anlam dönüştü',
  no_meaningful_change: 'Anlamlı değişiklik yok',
  uncertain: 'Belirsiz / karar veremiyorum',
};

export const VERDICT_ORDER: SemanticChangeVerdict[] = [
  'meaning_added',
  'meaning_removed',
  'meaning_transformed',
  'no_meaningful_change',
  'uncertain',
];

/** Turkish display labels for exclusion reasons, in the fixed order the review UI presents them. */
export const EXCLUSION_REASON_LABELS_TR: Record<Trial4ExclusionReason, string> = {
  synthetic_or_unrealistic: 'Yapay / gerçekçi olmayan edit',
  insufficient_context: 'Bağlam yetersiz',
  malformed_original_or_final: 'Original / Final bozuk',
  wrong_intervention_boundary: 'Edit sınırı yanlış çıkarılmış',
  too_easy_low_training_value: 'Çok kolay / eğitim değeri düşük',
  duplicate_or_near_duplicate: 'Duplicate / çok benzer örnek',
  misleading_turkish_explanation: 'Türkçe açıklama yanıltıcı',
  description_not_supported_by_edit: 'Model açıklaması edit tarafından desteklenmiyor',
  does_not_fit_category: 'Kategoriye düzgün oturmuyor',
  other: 'Diğer',
};

export const EXCLUSION_REASON_ORDER: Trial4ExclusionReason[] = [
  'synthetic_or_unrealistic',
  'insufficient_context',
  'malformed_original_or_final',
  'wrong_intervention_boundary',
  'too_easy_low_training_value',
  'duplicate_or_near_duplicate',
  'misleading_turkish_explanation',
  'description_not_supported_by_edit',
  'does_not_fit_category',
  'other',
];

/** Has this candidate ever been given a review decision? Absence of `reviewedAt` is the sole "pending" signal — never inferred from field defaults. */
export function isReviewed(candidate: Trial4TrainingCandidate): boolean {
  return candidate.reviewedAt !== undefined;
}

export function isPending(candidate: Trial4TrainingCandidate): boolean {
  return !isReviewed(candidate);
}

/** Explicitly excluded — reviewed AND not included. Distinct from "not yet reviewed," which also has includeInTraining === false but is not a decision. */
export function isExcluded(candidate: Trial4TrainingCandidate): boolean {
  return isReviewed(candidate) && !candidate.includeInTraining;
}

export function isIncluded(candidate: Trial4TrainingCandidate): boolean {
  return candidate.includeInTraining;
}

export function isLoreImportant(candidate: Trial4TrainingCandidate): boolean {
  return candidate.loreImportant;
}

/**
 * Human judgment disagrees with DeepSeek's proposal — either the verdict
 * differs, OR the (order-independent) dimension set differs, OR both (Test
 * 1 / v3 addendum: dimensions are a second axis a human can disagree with
 * DeepSeek on even when the verdict matches, e.g. same "no_meaningful_change"
 * verdict but the human sees a certainty shift DeepSeek missed). Only
 * meaningful once a human verdict exists — humanDimensions is [] by
 * default until reviewed, so it must never be compared before that.
 */
export function isDisagreement(candidate: Trial4TrainingCandidate): boolean {
  if (candidate.humanVerdict === null) return false;
  if (candidate.humanVerdict !== candidate.proposedVerdict) return true;
  return !dimensionSetsEqual(candidate.humanDimensions, candidate.proposedDimensions);
}

/**
 * The review UI's six-option composite verdict choice (Test 1 / v3
 * addendum) collapses onto exactly the 5 `SemanticChangeVerdict` values
 * plus `humanDimensions` — options 4 and 5 both store
 * `humanVerdict: 'no_meaningful_change'` and are distinguished only by
 * whether any dimension was selected. This type exists purely for the UI
 * layer to reason about which of the two the operator picked; it is never
 * itself persisted.
 */
export type Trial4CompositeVerdictOption =
  | 'meaning_added'
  | 'meaning_removed'
  | 'meaning_transformed'
  | 'no_meaningful_change_expression_shifted'
  | 'no_meaningful_change_no_shift'
  | 'uncertain';

/** Derives the composite UI option from stored `humanVerdict`/`humanDimensions` — the inverse of what the review UI writes back. Returns `null` when there is no human verdict yet (nothing to derive). */
export function composeVerdictOption(candidate: Trial4TrainingCandidate): Trial4CompositeVerdictOption | null {
  if (candidate.humanVerdict === null) return null;
  if (candidate.humanVerdict === 'no_meaningful_change') {
    return candidate.humanDimensions.length > 0 ? 'no_meaningful_change_expression_shifted' : 'no_meaningful_change_no_shift';
  }
  return candidate.humanVerdict;
}

/** Inverse of `composeVerdictOption` — what `humanVerdict` a chosen composite option should write. Dimension-emptiness for option 4 vs 5 is enforced by the UI (must select >=1 dimension for option 4), not by this function. */
export function verdictForCompositeOption(option: Trial4CompositeVerdictOption): SemanticChangeVerdict {
  if (option === 'no_meaningful_change_expression_shifted' || option === 'no_meaningful_change_no_shift') {
    return 'no_meaningful_change';
  }
  return option;
}

export type Trial4ReviewFilter = 'all' | 'pending' | 'disagreement' | 'lore' | 'excluded' | 'included';

const FILTER_PREDICATES: Record<Trial4ReviewFilter, (c: Trial4TrainingCandidate) => boolean> = {
  all: () => true,
  pending: isPending,
  disagreement: isDisagreement,
  lore: isLoreImportant,
  excluded: isExcluded,
  included: isIncluded,
};

/** Applies one of the review-workspace filters. Pure — no storage access, no mutation. */
export function filterCandidates(
  candidates: Trial4TrainingCandidate[],
  filter: Trial4ReviewFilter,
): Trial4TrainingCandidate[] {
  return candidates.filter(FILTER_PREDICATES[filter]);
}

export interface Trial4ReviewStats {
  total: number;
  reviewed: number;
  remaining: number;
  includedInTraining: number;
  excluded: number;
  disagreements: number;
  loreImportant: number;
}

/** Pure aggregation for the Dashboard Overview page — every count derived directly from the candidate list, nothing fabricated. */
export function computeReviewStats(candidates: Trial4TrainingCandidate[]): Trial4ReviewStats {
  let reviewed = 0;
  let includedInTraining = 0;
  let excluded = 0;
  let disagreements = 0;
  let loreImportant = 0;

  for (const candidate of candidates) {
    if (isReviewed(candidate)) reviewed += 1;
    if (isIncluded(candidate)) includedInTraining += 1;
    if (isExcluded(candidate)) excluded += 1;
    if (isDisagreement(candidate)) disagreements += 1;
    if (isLoreImportant(candidate)) loreImportant += 1;
  }

  return {
    total: candidates.length,
    reviewed,
    remaining: candidates.length - reviewed,
    includedInTraining,
    excluded,
    disagreements,
    loreImportant,
  };
}

/**
 * Trial 4's three distinct human-reviewed export artifacts
 * (docs/decisions/0017's structured-decisions addendum) — evidence for a
 * future explicit failure-driven decision, never auto-consumed. Each
 * function is a pure filter; the caller (Dashboard Data/Exports page)
 * owns turning the result into a downloadable file.
 */
export function buildTrainingDatasetExport(candidates: Trial4TrainingCandidate[]): Trial4TrainingCandidate[] {
  return filterCandidates(candidates, 'included');
}

export function buildLoreEvidenceExport(candidates: Trial4TrainingCandidate[]): Trial4TrainingCandidate[] {
  return filterCandidates(candidates, 'lore');
}

export function buildGenerationFailuresExport(candidates: Trial4TrainingCandidate[]): Trial4TrainingCandidate[] {
  return filterCandidates(candidates, 'excluded');
}
