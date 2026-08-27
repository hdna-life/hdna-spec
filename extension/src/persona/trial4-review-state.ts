import type { SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
import type { Trial4ExclusionReason, Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';

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

/** Human verdict disagrees with DeepSeek's proposal — only meaningful once a human verdict exists. */
export function isDisagreement(candidate: Trial4TrainingCandidate): boolean {
  return candidate.humanVerdict !== null && candidate.humanVerdict !== candidate.proposedVerdict;
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
