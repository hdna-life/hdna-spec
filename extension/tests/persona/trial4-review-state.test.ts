import { describe, expect, it } from 'vitest';
import type { Trial4TrainingCandidate, Trial4ExclusionReason } from '@spec/schema/trial4-training-candidate';
import type { SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
import {
  VERDICT_LABELS_TR,
  VERDICT_ORDER,
  EXCLUSION_REASON_LABELS_TR,
  EXCLUSION_REASON_ORDER,
  isReviewed,
  isPending,
  isExcluded,
  isIncluded,
  isLoreImportant,
  isDisagreement,
  composeVerdictOption,
  verdictForCompositeOption,
  filterCandidates,
  computeReviewStats,
  buildTrainingDatasetExport,
  buildLoreEvidenceExport,
  buildGenerationFailuresExport,
  Trial4ReviewFilter,
} from '../../src/persona/trial4-review-state';

function candidate(overrides: Partial<Trial4TrainingCandidate> = {}): Trial4TrainingCandidate {
  return {
    id: 'candidate1',
    kind: 'replaced',
    originalText: 'original text',
    finalText: 'final text',
    beforeContext: 'before context',
    afterContext: 'after context',
    proposedVerdict: 'meaning_added',
    proposedDimensions: [],
    proposedDescription: 'A change was made.',
    humanVerdict: null,
    humanDimensions: [],
    includeInTraining: false,
    exclusionReasons: [],
    operatorNoteTr: '',
    loreImportant: false,
    loreNoteTr: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('trial4-review-state', () => {
  describe('VERDICT_LABELS_TR', () => {
    it('has exactly 5 keys with non-empty Turkish strings', () => {
      const keys = Object.keys(VERDICT_LABELS_TR);
      expect(keys).toHaveLength(5);
      expect(keys.sort()).toEqual([
        'meaning_added',
        'meaning_removed',
        'meaning_transformed',
        'no_meaningful_change',
        'uncertain',
      ]);

      for (const key of keys) {
        const verdict = key as SemanticChangeVerdict;
        const label = VERDICT_LABELS_TR[verdict];
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('VERDICT_ORDER', () => {
    it('has exactly the 5 verdicts in the correct order', () => {
      expect(VERDICT_ORDER).toEqual([
        'meaning_added',
        'meaning_removed',
        'meaning_transformed',
        'no_meaningful_change',
        'uncertain',
      ]);
      expect(VERDICT_ORDER).toHaveLength(5);
    });

    it('contains the same values as VERDICT_LABELS_TR keys', () => {
      const labelKeys = Object.keys(VERDICT_LABELS_TR).sort();
      const orderKeys = VERDICT_ORDER.slice().sort();
      expect(orderKeys).toEqual(labelKeys);
    });
  });

  describe('EXCLUSION_REASON_LABELS_TR', () => {
    it('has exactly 10 keys with non-empty Turkish strings', () => {
      const keys = Object.keys(EXCLUSION_REASON_LABELS_TR);
      expect(keys).toHaveLength(10);
      expect(keys.sort()).toEqual([
        'description_not_supported_by_edit',
        'does_not_fit_category',
        'duplicate_or_near_duplicate',
        'insufficient_context',
        'malformed_original_or_final',
        'misleading_turkish_explanation',
        'other',
        'synthetic_or_unrealistic',
        'too_easy_low_training_value',
        'wrong_intervention_boundary',
      ]);

      for (const key of keys) {
        const reason = key as Trial4ExclusionReason;
        const label = EXCLUSION_REASON_LABELS_TR[reason];
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('EXCLUSION_REASON_ORDER', () => {
    it('has exactly the 10 exclusion reasons in the correct order', () => {
      expect(EXCLUSION_REASON_ORDER).toEqual([
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
      ]);
      expect(EXCLUSION_REASON_ORDER).toHaveLength(10);
    });

    it('contains the same values as EXCLUSION_REASON_LABELS_TR keys', () => {
      const labelKeys = Object.keys(EXCLUSION_REASON_LABELS_TR).sort();
      const orderKeys = EXCLUSION_REASON_ORDER.slice().sort();
      expect(orderKeys).toEqual(labelKeys);
    });
  });

  describe('isReviewed', () => {
    it('returns true when reviewedAt is defined', () => {
      const c = candidate({ reviewedAt: '2026-01-02T00:00:00.000Z' });
      expect(isReviewed(c)).toBe(true);
    });

    it('returns false when reviewedAt is undefined', () => {
      const c = candidate();
      expect(c.reviewedAt).toBeUndefined();
      expect(isReviewed(c)).toBe(false);
    });
  });

  describe('isPending', () => {
    it('returns true when reviewedAt is undefined', () => {
      const c = candidate();
      expect(isPending(c)).toBe(true);
    });

    it('returns false when reviewedAt is defined', () => {
      const c = candidate({ reviewedAt: '2026-01-02T00:00:00.000Z' });
      expect(isPending(c)).toBe(false);
    });

    it('is the exact negation of isReviewed', () => {
      const reviewed = candidate({ reviewedAt: '2026-01-02T00:00:00.000Z' });
      const pending = candidate();
      expect(isPending(reviewed)).toBe(!isReviewed(reviewed));
      expect(isPending(pending)).toBe(!isReviewed(pending));
    });
  });

  describe('isExcluded', () => {
    it('returns true when reviewed AND includeInTraining is false', () => {
      const c = candidate({
        reviewedAt: '2026-01-02T00:00:00.000Z',
        includeInTraining: false,
      });
      expect(isExcluded(c)).toBe(true);
    });

    it('returns false when reviewed but includeInTraining is true', () => {
      const c = candidate({
        reviewedAt: '2026-01-02T00:00:00.000Z',
        includeInTraining: true,
      });
      expect(isExcluded(c)).toBe(false);
    });

    it('returns false when unreviewed (pending) even if includeInTraining is false', () => {
      const c = candidate({
        includeInTraining: false,
      });
      expect(c.reviewedAt).toBeUndefined();
      expect(isExcluded(c)).toBe(false);
    });

    it('returns false when unreviewed and includeInTraining is true', () => {
      const c = candidate({
        includeInTraining: true,
      });
      expect(c.reviewedAt).toBeUndefined();
      expect(isExcluded(c)).toBe(false);
    });

    it('distinguishes explicitly excluded (reviewed + false) from pending (unreviewed + false)', () => {
      const pending = candidate({ includeInTraining: false });
      const excluded = candidate({
        reviewedAt: '2026-01-02T00:00:00.000Z',
        includeInTraining: false,
      });
      expect(isExcluded(pending)).toBe(false);
      expect(isExcluded(excluded)).toBe(true);
    });
  });

  describe('isIncluded', () => {
    it('returns true when includeInTraining is true', () => {
      const c = candidate({ includeInTraining: true });
      expect(isIncluded(c)).toBe(true);
    });

    it('returns false when includeInTraining is false', () => {
      const c = candidate({ includeInTraining: false });
      expect(isIncluded(c)).toBe(false);
    });

    it('is exactly candidate.includeInTraining', () => {
      const included = candidate({ includeInTraining: true });
      const notIncluded = candidate({ includeInTraining: false });
      expect(isIncluded(included)).toBe(included.includeInTraining);
      expect(isIncluded(notIncluded)).toBe(notIncluded.includeInTraining);
    });
  });

  describe('isLoreImportant', () => {
    it('returns true when loreImportant is true', () => {
      const c = candidate({ loreImportant: true });
      expect(isLoreImportant(c)).toBe(true);
    });

    it('returns false when loreImportant is false', () => {
      const c = candidate({ loreImportant: false });
      expect(isLoreImportant(c)).toBe(false);
    });

    it('is exactly candidate.loreImportant', () => {
      const lore = candidate({ loreImportant: true });
      const notLore = candidate({ loreImportant: false });
      expect(isLoreImportant(lore)).toBe(lore.loreImportant);
      expect(isLoreImportant(notLore)).toBe(notLore.loreImportant);
    });
  });

  describe('isDisagreement', () => {
    it('returns true when humanVerdict is not null and differs from proposedVerdict', () => {
      const c = candidate({
        proposedVerdict: 'meaning_added',
        humanVerdict: 'meaning_removed',
      });
      expect(isDisagreement(c)).toBe(true);
    });

    it('returns false when humanVerdict is null', () => {
      const c = candidate({
        proposedVerdict: 'meaning_added',
        humanVerdict: null,
      });
      expect(isDisagreement(c)).toBe(false);
    });

    it('returns false when humanVerdict equals proposedVerdict', () => {
      const c = candidate({
        proposedVerdict: 'meaning_added',
        humanVerdict: 'meaning_added',
      });
      expect(isDisagreement(c)).toBe(false);
    });

    it('returns false when humanVerdict is null even if proposedVerdict could differ', () => {
      const c = candidate({
        proposedVerdict: 'meaning_removed',
        humanVerdict: null,
      });
      expect(isDisagreement(c)).toBe(false);
    });

    it('returns true when verdicts match but the dimension SET differs (Test 1 / v3 addendum)', () => {
      const c = candidate({
        proposedVerdict: 'no_meaningful_change',
        proposedDimensions: [{ dimension: 'certainty', direction: 'increased' }],
        humanVerdict: 'no_meaningful_change',
        humanDimensions: [{ dimension: 'directness', direction: 'increased' }],
      });
      expect(isDisagreement(c)).toBe(true);
    });

    it('returns false when verdicts match and dimension sets are equal but reordered', () => {
      const c = candidate({
        proposedVerdict: 'meaning_transformed',
        proposedDimensions: [
          { dimension: 'certainty', direction: 'increased' },
          { dimension: 'commitment', direction: 'increased' },
        ],
        humanVerdict: 'meaning_transformed',
        humanDimensions: [
          { dimension: 'commitment', direction: 'increased' },
          { dimension: 'certainty', direction: 'increased' },
        ],
      });
      expect(isDisagreement(c)).toBe(false);
    });

    it('returns true when dimension sets differ only in count', () => {
      const c = candidate({
        proposedVerdict: 'meaning_added',
        proposedDimensions: [{ dimension: 'certainty', direction: 'increased' }],
        humanVerdict: 'meaning_added',
        humanDimensions: [
          { dimension: 'certainty', direction: 'increased' },
          { dimension: 'formality', direction: 'increased' },
        ],
      });
      expect(isDisagreement(c)).toBe(true);
    });

    it('returns false when both proposed and human dimensions are empty and verdicts match', () => {
      const c = candidate({
        proposedVerdict: 'meaning_transformed',
        proposedDimensions: [],
        humanVerdict: 'meaning_transformed',
        humanDimensions: [],
      });
      expect(isDisagreement(c)).toBe(false);
    });
  });

  describe('composeVerdictOption / verdictForCompositeOption (six-option composite UI, Test 1 / v3 addendum)', () => {
    it('returns null when there is no human verdict yet', () => {
      const c = candidate({ humanVerdict: null });
      expect(composeVerdictOption(c)).toBeNull();
    });

    it('maps meaning_added/meaning_removed/meaning_transformed/uncertain straight through', () => {
      for (const verdict of ['meaning_added', 'meaning_removed', 'meaning_transformed', 'uncertain'] as const) {
        const c = candidate({ humanVerdict: verdict });
        expect(composeVerdictOption(c)).toBe(verdict);
      }
    });

    it('maps no_meaningful_change with dimensions to option 4 (expression shifted)', () => {
      const c = candidate({
        humanVerdict: 'no_meaningful_change',
        humanDimensions: [{ dimension: 'certainty', direction: 'increased' }],
      });
      expect(composeVerdictOption(c)).toBe('no_meaningful_change_expression_shifted');
    });

    it('maps no_meaningful_change with no dimensions to option 5 (no shift)', () => {
      const c = candidate({ humanVerdict: 'no_meaningful_change', humanDimensions: [] });
      expect(composeVerdictOption(c)).toBe('no_meaningful_change_no_shift');
    });

    it('verdictForCompositeOption is the inverse for both no_meaningful_change options', () => {
      expect(verdictForCompositeOption('no_meaningful_change_expression_shifted')).toBe('no_meaningful_change');
      expect(verdictForCompositeOption('no_meaningful_change_no_shift')).toBe('no_meaningful_change');
    });

    it('verdictForCompositeOption passes the other four options through unchanged', () => {
      for (const option of ['meaning_added', 'meaning_removed', 'meaning_transformed', 'uncertain'] as const) {
        expect(verdictForCompositeOption(option)).toBe(option);
      }
    });
  });

  describe('filterCandidates', () => {
    function buildTestList(): Trial4TrainingCandidate[] {
      return [
        candidate({ id: 'pending1' }),
        candidate({
          id: 'included-agree',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
          humanVerdict: 'meaning_added',
          proposedVerdict: 'meaning_added',
        }),
        candidate({
          id: 'included-disagree',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
          humanVerdict: 'meaning_removed',
          proposedVerdict: 'meaning_added',
        }),
        candidate({
          id: 'excluded-reason1',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
          exclusionReasons: ['synthetic_or_unrealistic'],
        }),
        candidate({
          id: 'lore-important-excluded',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
          loreImportant: true,
          loreNoteTr: 'Important boundary',
          exclusionReasons: ['too_easy_low_training_value'],
        }),
        candidate({
          id: 'lore-important-included',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
          loreImportant: true,
          loreNoteTr: 'Another boundary',
          humanVerdict: 'meaning_transformed',
          proposedVerdict: 'meaning_transformed',
        }),
      ];
    }

    it('filters by "all" returns every candidate', () => {
      const candidates = buildTestList();
      const result = filterCandidates(candidates, 'all');
      expect(result).toHaveLength(6);
      expect(result.map((c) => c.id).sort()).toEqual([
        'excluded-reason1',
        'included-agree',
        'included-disagree',
        'lore-important-excluded',
        'lore-important-included',
        'pending1',
      ]);
    });

    it('filters by "pending" returns only unreviewed candidates', () => {
      const candidates = buildTestList();
      const result = filterCandidates(candidates, 'pending');
      expect(result.map((c) => c.id)).toEqual(['pending1']);
    });

    it('filters by "disagreement" returns only candidates with humanVerdict !== proposedVerdict', () => {
      const candidates = buildTestList();
      const result = filterCandidates(candidates, 'disagreement');
      expect(result.map((c) => c.id)).toEqual(['included-disagree']);
    });

    it('filters by "lore" returns only candidates with loreImportant === true', () => {
      const candidates = buildTestList();
      const result = filterCandidates(candidates, 'lore');
      expect(result.map((c) => c.id).sort()).toEqual([
        'lore-important-excluded',
        'lore-important-included',
      ]);
    });

    it('filters by "excluded" returns only reviewed candidates with includeInTraining === false', () => {
      const candidates = buildTestList();
      const result = filterCandidates(candidates, 'excluded');
      expect(result.map((c) => c.id).sort()).toEqual([
        'excluded-reason1',
        'lore-important-excluded',
      ]);
    });

    it('filters by "included" returns only candidates with includeInTraining === true', () => {
      const candidates = buildTestList();
      const result = filterCandidates(candidates, 'included');
      expect(result.map((c) => c.id).sort()).toEqual([
        'included-agree',
        'included-disagree',
        'lore-important-included',
      ]);
    });

    it('does not include pending candidates in "excluded" filter', () => {
      const candidates = buildTestList();
      const excluded = filterCandidates(candidates, 'excluded');
      const hasPending = excluded.some((c) => !isReviewed(c));
      expect(hasPending).toBe(false);
    });
  });

  describe('computeReviewStats', () => {
    it('returns all zeros for an empty list', () => {
      const stats = computeReviewStats([]);
      expect(stats).toEqual({
        total: 0,
        reviewed: 0,
        remaining: 0,
        includedInTraining: 0,
        excluded: 0,
        disagreements: 0,
        loreImportant: 0,
      });
    });

    it('computes correct stats for a mixed candidate list', () => {
      const candidates = [
        candidate({ id: 'pending1' }),
        candidate({
          id: 'included-agree',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
          humanVerdict: 'meaning_added',
          proposedVerdict: 'meaning_added',
        }),
        candidate({
          id: 'included-disagree',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
          humanVerdict: 'meaning_removed',
          proposedVerdict: 'meaning_added',
        }),
        candidate({
          id: 'excluded-reason1',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
          exclusionReasons: ['synthetic_or_unrealistic'],
        }),
        candidate({
          id: 'lore-important-excluded',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
          loreImportant: true,
          loreNoteTr: 'Important boundary',
          exclusionReasons: ['too_easy_low_training_value'],
        }),
        candidate({
          id: 'lore-important-included',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
          loreImportant: true,
          loreNoteTr: 'Another boundary',
          humanVerdict: 'meaning_transformed',
          proposedVerdict: 'meaning_transformed',
        }),
      ];

      const stats = computeReviewStats(candidates);

      expect(stats.total).toBe(6);
      expect(stats.reviewed).toBe(5); // all except 'pending1'
      expect(stats.remaining).toBe(1); // just 'pending1'
      expect(stats.includedInTraining).toBe(3); // included-agree, included-disagree, lore-important-included
      expect(stats.excluded).toBe(2); // excluded-reason1, lore-important-excluded
      expect(stats.disagreements).toBe(1); // included-disagree
      expect(stats.loreImportant).toBe(2); // lore-important-excluded, lore-important-included
    });

    it('correctly counts remaining as total - reviewed', () => {
      const candidates = [
        candidate(),
        candidate(),
        candidate({ reviewedAt: '2026-01-02T00:00:00.000Z' }),
      ];
      const stats = computeReviewStats(candidates);
      expect(stats.total).toBe(3);
      expect(stats.reviewed).toBe(1);
      expect(stats.remaining).toBe(2);
      expect(stats.remaining).toBe(stats.total - stats.reviewed);
    });
  });

  describe('buildTrainingDatasetExport', () => {
    it('returns only candidates with includeInTraining === true', () => {
      const candidates = [
        candidate({ id: 'included1', includeInTraining: true }),
        candidate({ id: 'pending1', includeInTraining: false }),
        candidate({ id: 'included2', includeInTraining: true }),
        candidate({
          id: 'excluded1',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
        }),
      ];

      const result = buildTrainingDatasetExport(candidates);
      expect(result.map((c) => c.id)).toEqual(['included1', 'included2']);
    });

    it('does not include excluded candidates even if they are lore-important', () => {
      const candidates = [
        candidate({
          id: 'lore-excluded',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
          loreImportant: true,
        }),
        candidate({
          id: 'included-not-lore',
          includeInTraining: true,
          loreImportant: false,
        }),
      ];

      const result = buildTrainingDatasetExport(candidates);
      expect(result.map((c) => c.id)).toEqual(['included-not-lore']);
    });

    it('does not include pending candidates', () => {
      const candidates = [
        candidate({
          id: 'pending-not-included',
          includeInTraining: false,
        }),
      ];

      const result = buildTrainingDatasetExport(candidates);
      expect(result).toHaveLength(0);
    });

    it('is equivalent to filterCandidates with "included" filter', () => {
      const candidates = [
        candidate({ id: 'c1', includeInTraining: true }),
        candidate({ id: 'c2', includeInTraining: false }),
        candidate({ id: 'c3', includeInTraining: true }),
      ];

      const exportResult = buildTrainingDatasetExport(candidates);
      const filterResult = filterCandidates(candidates, 'included');
      expect(exportResult.map((c) => c.id)).toEqual(filterResult.map((c) => c.id));
    });
  });

  describe('buildLoreEvidenceExport', () => {
    it('returns only candidates with loreImportant === true regardless of includeInTraining', () => {
      const candidates = [
        candidate({
          id: 'lore-included',
          loreImportant: true,
          includeInTraining: true,
        }),
        candidate({
          id: 'lore-excluded',
          loreImportant: true,
          includeInTraining: false,
          reviewedAt: '2026-01-02T00:00:00.000Z',
        }),
        candidate({
          id: 'not-lore',
          loreImportant: false,
          includeInTraining: true,
        }),
      ];

      const result = buildLoreEvidenceExport(candidates);
      expect(result.map((c) => c.id).sort()).toEqual([
        'lore-excluded',
        'lore-included',
      ]);
    });

    it('includes both lore-important-and-included and lore-important-and-excluded', () => {
      const loreIncluded = candidate({
        id: 'lore1',
        loreImportant: true,
        includeInTraining: true,
      });
      const loreExcluded = candidate({
        id: 'lore2',
        loreImportant: true,
        includeInTraining: false,
        reviewedAt: '2026-01-02T00:00:00.000Z',
      });

      const result = buildLoreEvidenceExport([loreIncluded, loreExcluded]);
      expect(result).toContainEqual(loreIncluded);
      expect(result).toContainEqual(loreExcluded);
    });

    it('is equivalent to filterCandidates with "lore" filter', () => {
      const candidates = [
        candidate({ id: 'c1', loreImportant: true }),
        candidate({ id: 'c2', loreImportant: false }),
        candidate({ id: 'c3', loreImportant: true }),
      ];

      const exportResult = buildLoreEvidenceExport(candidates);
      const filterResult = filterCandidates(candidates, 'lore');
      expect(exportResult.map((c) => c.id)).toEqual(filterResult.map((c) => c.id));
    });
  });

  describe('buildGenerationFailuresExport', () => {
    it('returns only candidates where isExcluded is true (reviewed AND not included)', () => {
      const candidates = [
        candidate({
          id: 'excluded1',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
        }),
        candidate({
          id: 'pending1',
          includeInTraining: false,
        }),
        candidate({
          id: 'included1',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
        }),
      ];

      const result = buildGenerationFailuresExport(candidates);
      expect(result.map((c) => c.id)).toEqual(['excluded1']);
    });

    it('does not include pending candidates with includeInTraining false', () => {
      const candidates = [
        candidate({
          id: 'pending-not-included',
          includeInTraining: false,
        }),
      ];

      const result = buildGenerationFailuresExport(candidates);
      expect(result).toHaveLength(0);
    });

    it('distinguishes explicitly excluded from pending even when includeInTraining is false', () => {
      const pending = candidate({
        id: 'pending',
        includeInTraining: false,
      });
      const excluded = candidate({
        id: 'excluded',
        reviewedAt: '2026-01-02T00:00:00.000Z',
        includeInTraining: false,
      });

      const result = buildGenerationFailuresExport([pending, excluded]);
      expect(result.map((c) => c.id)).toEqual(['excluded']);
      expect(result).not.toContainEqual(pending);
    });

    it('is equivalent to filterCandidates with "excluded" filter', () => {
      const candidates = [
        candidate({
          id: 'c1',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: false,
        }),
        candidate({ id: 'c2', includeInTraining: false }),
        candidate({
          id: 'c3',
          reviewedAt: '2026-01-02T00:00:00.000Z',
          includeInTraining: true,
        }),
      ];

      const exportResult = buildGenerationFailuresExport(candidates);
      const filterResult = filterCandidates(candidates, 'excluded');
      expect(exportResult.map((c) => c.id)).toEqual(filterResult.map((c) => c.id));
    });
  });
});
