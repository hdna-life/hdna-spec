import { describe, expect, it } from 'vitest';
import { computeTrial4BenchmarkStats } from '../../src/persona/trial4-benchmark-stats';
import type { Trial4BenchmarkResponse, Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';

function response(role: Trial4BenchmarkResponse['role'], overrides: Partial<Trial4BenchmarkResponse> = {}): Trial4BenchmarkResponse {
  return {
    role,
    verdict: 'meaning_transformed',
    dimensions: [],
    description: 'x',
    confidence: 0.7,
    error: null,
    grade: null,
    humanAcceptable: null,
    humanRank: null,
    ...overrides,
  };
}

function result(overrides: Partial<Trial4BenchmarkResult> = {}): Trial4BenchmarkResult {
  return {
    id: 'r1',
    caseId: 'c1',
    labelMapping: {
      A: response('base'),
      B: response('trained'),
      C: response('deepseek'),
    },
    bestResponse: null,
    note: '',
    judged: false,
    revealed: false,
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function benchmarkCase(overrides: Partial<Trial4BenchmarkCase> = {}): Trial4BenchmarkCase {
  return {
    id: 'c1',
    kind: 'replaced',
    originalText: 'x',
    finalText: 'y',
    beforeContext: '',
    afterContext: '',
    humanVerdict: null,
    humanDimensions: [],
    groundTruthLocked: false,
    ...overrides,
  };
}

/** Convenience for the ground-truth tests below — a locked case always has both humanVerdict and humanDimensions set. */
function lockedCase(overrides: Partial<Trial4BenchmarkCase> = {}): Trial4BenchmarkCase {
  return benchmarkCase({
    humanVerdict: 'meaning_added',
    humanDimensions: [],
    groundTruthLocked: true,
    ...overrides,
  });
}

describe('computeTrial4BenchmarkStats', () => {
  it('returns all-zero/null stats for an empty result set', () => {
    const stats = computeTrial4BenchmarkStats([]);
    expect(stats.base.judgedCount).toBe(0);
    expect(stats.base.correctRate).toBe(0);
    expect(stats.base.acceptableRate).toBe(0);
    expect(stats.base.meanRankAmongAcceptable).toBeNull();
    expect(stats.base.verdictAccuracy).toBeNull();
    expect(stats.base.dimensionExactSetAccuracy).toBeNull();
    expect(stats.base.dimensionMicroF1).toBeNull();
    expect(stats.trainedVsBaseImprovement).toBe(0);
    expect(stats.judgedResultCount).toBe(0);
    expect(stats.totalResultCount).toBe(0);
    expect(stats.noAcceptableResponseCount).toBe(0);
  });

  it('ignores unjudged results entirely', () => {
    const results = [result({ judged: false })];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.judgedResultCount).toBe(0);
    expect(stats.totalResultCount).toBe(1);
    expect(stats.base.judgedCount).toBe(0);
  });

  it('counts legacy correct/partial/wrong per role, independent of which label the role landed on', () => {
    const results = [
      result({
        judged: true,
        labelMapping: {
          A: response('trained', { grade: 'correct' }),
          B: response('base', { grade: 'wrong' }),
          C: response('deepseek', { grade: 'partial' }),
        },
      }),
    ];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.base.wrong).toBe(1);
    expect(stats.trained.correct).toBe(1);
    expect(stats.deepseek.partial).toBe(1);
  });

  it('computes legacy correctRate as correct / judgedCount', () => {
    const results = [
      result({
        judged: true,
        labelMapping: {
          A: response('base', { grade: 'correct' }),
          B: response('trained', { grade: 'wrong' }),
          C: response('deepseek', { grade: 'correct' }),
        },
      }),
      result({
        judged: true,
        labelMapping: {
          A: response('trained', { grade: 'correct' }),
          B: response('base', { grade: 'correct' }),
          C: response('deepseek', { grade: 'wrong' }),
        },
      }),
    ];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.base.judgedCount).toBe(2);
    expect(stats.base.correct).toBe(2);
    expect(stats.base.correctRate).toBe(1);
    expect(stats.trained.judgedCount).toBe(2);
    expect(stats.trained.correct).toBe(1);
    expect(stats.trained.correctRate).toBe(0.5);
  });

  it('counts a role error separately from acceptability, and does not count it toward acceptabilityJudgedCount', () => {
    const results = [
      result({
        judged: true,
        labelMapping: {
          A: response('base', { grade: null, error: 'Local MLX server unreachable', verdict: null }),
          B: response('trained', { humanAcceptable: true, humanRank: 1 }),
          C: response('deepseek', { humanAcceptable: true, humanRank: 2 }),
        },
      }),
    ];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.base.errors).toBe(1);
    expect(stats.base.acceptabilityJudgedCount).toBe(0);
    expect(stats.base.acceptableCount).toBe(0);
  });

  describe('acceptability + ranking (docs/decisions/0017 addendum)', () => {
    it('computes acceptableRate / unacceptableRate per role', () => {
      const results = [
        result({
          judged: true,
          labelMapping: {
            A: response('base', { humanAcceptable: false, humanRank: null }),
            B: response('trained', { humanAcceptable: true, humanRank: 1 }),
            C: response('deepseek', { humanAcceptable: true, humanRank: 2 }),
          },
        }),
        result({
          judged: true,
          labelMapping: {
            A: response('base', { humanAcceptable: true, humanRank: 1 }),
            B: response('trained', { humanAcceptable: false, humanRank: null }),
            C: response('deepseek', { humanAcceptable: true, humanRank: 2 }),
          },
        }),
      ];
      const stats = computeTrial4BenchmarkStats(results);
      expect(stats.base.acceptabilityJudgedCount).toBe(2);
      expect(stats.base.acceptableCount).toBe(1);
      expect(stats.base.acceptableRate).toBe(0.5);
      expect(stats.base.unacceptableRate).toBe(0.5);
      expect(stats.deepseek.acceptableRate).toBe(1);
    });

    it('computes rank1Rate and meanRankAmongAcceptable per role', () => {
      const results = [
        result({
          judged: true,
          labelMapping: {
            A: response('base', { humanAcceptable: true, humanRank: 2 }),
            B: response('trained', { humanAcceptable: true, humanRank: 1 }),
            C: response('deepseek', { humanAcceptable: true, humanRank: 3 }),
          },
        }),
        result({
          judged: true,
          labelMapping: {
            A: response('base', { humanAcceptable: true, humanRank: 1 }),
            B: response('trained', { humanAcceptable: true, humanRank: 2 }),
            C: response('deepseek', { humanAcceptable: false, humanRank: null }),
          },
        }),
      ];
      const stats = computeTrial4BenchmarkStats(results);
      expect(stats.base.rank1Count).toBe(1);
      expect(stats.base.rank1Rate).toBe(0.5);
      expect(stats.base.meanRankAmongAcceptable).toBeCloseTo(1.5, 5);
      expect(stats.trained.rank1Count).toBe(1);
      expect(stats.trained.meanRankAmongAcceptable).toBeCloseTo(1.5, 5);
      expect(stats.deepseek.acceptableCount).toBe(1);
      expect(stats.deepseek.meanRankAmongAcceptable).toBe(3);
    });

    it('computes trainedVsBaseImprovement as trained.acceptableRate - base.acceptableRate (can be negative)', () => {
      const results = [
        result({
          judged: true,
          labelMapping: {
            A: response('base', { humanAcceptable: true, humanRank: 1 }),
            B: response('trained', { humanAcceptable: false, humanRank: null }),
            C: response('deepseek', { humanAcceptable: true, humanRank: 2 }),
          },
        }),
      ];
      const stats = computeTrial4BenchmarkStats(results);
      expect(stats.trainedVsBaseImprovement).toBeCloseTo(0 - 1, 5);
    });

    it('counts win rates from bestResponse, resolved to the winning role — derived from rank 1, no tie handling', () => {
      const results = [
        result({ judged: true, bestResponse: 'A', labelMapping: { A: response('trained'), B: response('base'), C: response('deepseek') } }),
        result({ judged: true, bestResponse: 'B', labelMapping: { A: response('base'), B: response('deepseek'), C: response('trained') } }),
      ];
      const stats = computeTrial4BenchmarkStats(results);
      expect(stats.winCounts.trained).toBe(1);
      expect(stats.winCounts.deepseek).toBe(1);
      expect(stats.winCounts.base).toBe(0);
    });

    it('does not count a null bestResponse (judged but not yet resolved) as a win', () => {
      const results = [result({ judged: true, bestResponse: null })];
      const stats = computeTrial4BenchmarkStats(results);
      expect(stats.winCounts.base + stats.winCounts.trained + stats.winCounts.deepseek).toBe(0);
    });

    it('counts a case with zero acceptable responses as noAcceptableResponseCount, not an error', () => {
      const results = [
        result({
          judged: true,
          bestResponse: null,
          labelMapping: {
            A: response('base', { humanAcceptable: false, humanRank: null }),
            B: response('trained', { humanAcceptable: false, humanRank: null }),
            C: response('deepseek', { humanAcceptable: false, humanRank: null }),
          },
        }),
      ];
      const stats = computeTrial4BenchmarkStats(results);
      expect(stats.noAcceptableResponseCount).toBe(1);
      expect(stats.base.errors).toBe(0);
    });
  });

  describe('ground-truth accuracy (frozen, LOCKED humanVerdict/humanDimensions — Test 1 primary metric)', () => {
    it('stays null when no case in this run carries locked ground truth', () => {
      const results = [result({ judged: true, caseId: 'c1' })];
      const cases = [benchmarkCase({ id: 'c1' })];
      const stats = computeTrial4BenchmarkStats(results, cases);
      expect(stats.base.verdictAccuracy).toBeNull();
      expect(stats.base.dimensionExactSetAccuracy).toBeNull();
      expect(stats.base.dimensionMicroF1).toBeNull();
    });

    it('does not count an UNLOCKED case even if humanVerdict/humanDimensions happen to be set', () => {
      const results = [
        result({
          judged: true,
          caseId: 'c1',
          labelMapping: {
            A: response('base', { verdict: 'meaning_added' }),
            B: response('trained', { verdict: 'meaning_added' }),
            C: response('deepseek', { verdict: 'meaning_added' }),
          },
        }),
      ];
      // groundTruthLocked: false, even though humanVerdict happens to be set —
      // must not be scored against, mirroring the "not committed, doesn't
      // count" rule for humanAcceptable/humanRank.
      const cases = [benchmarkCase({ id: 'c1', humanVerdict: 'meaning_added', groundTruthLocked: false })];
      const stats = computeTrial4BenchmarkStats(results, cases);
      expect(stats.base.verdictAccuracyCount).toBe(0);
      expect(stats.base.verdictAccuracy).toBeNull();
    });

    it('computes verdictAccuracy (5-way semantic exact accuracy) against a locked humanVerdict, per role', () => {
      const results = [
        result({
          judged: true,
          caseId: 'c1',
          labelMapping: {
            A: response('base', { verdict: 'meaning_added' }),
            B: response('trained', { verdict: 'meaning_transformed' }),
            C: response('deepseek', { verdict: 'meaning_added' }),
          },
        }),
      ];
      const cases = [lockedCase({ id: 'c1', humanVerdict: 'meaning_added' })];
      const stats = computeTrial4BenchmarkStats(results, cases);
      expect(stats.base.verdictAccuracyCount).toBe(1);
      expect(stats.base.verdictAccuracy).toBe(1);
      expect(stats.trained.verdictAccuracy).toBe(0);
      expect(stats.deepseek.verdictAccuracy).toBe(1);
    });

    it('computes dimensionExactSetAccuracy as order-independent set equality', () => {
      const results = [
        result({
          judged: true,
          caseId: 'c1',
          labelMapping: {
            A: response('base', {
              dimensions: [
                { dimension: 'certainty', direction: 'increased' },
                { dimension: 'directness', direction: 'increased' },
              ],
            }),
            B: response('trained', {
              dimensions: [{ dimension: 'certainty', direction: 'increased' }],
            }),
            C: response('deepseek', {
              dimensions: [
                { dimension: 'directness', direction: 'increased' },
                { dimension: 'certainty', direction: 'increased' },
              ],
            }),
          },
        }),
      ];
      const cases = [
        lockedCase({
          id: 'c1',
          humanDimensions: [
            { dimension: 'certainty', direction: 'increased' },
            { dimension: 'directness', direction: 'increased' },
          ],
        }),
      ];
      const stats = computeTrial4BenchmarkStats(results, cases);
      expect(stats.base.dimensionExactSetAccuracy).toBe(1);
      expect(stats.trained.dimensionExactSetAccuracy).toBe(0);
      expect(stats.deepseek.dimensionExactSetAccuracy).toBe(1);
    });

    it('computes micro-averaged dimension F1 across (dimension, direction) pairs', () => {
      const results = [
        result({
          judged: true,
          caseId: 'c1',
          labelMapping: {
            A: response('base', {
              dimensions: [
                { dimension: 'certainty', direction: 'increased' },
                { dimension: 'formality', direction: 'increased' },
              ],
            }),
            B: response('trained', { dimensions: [] }),
            C: response('deepseek', {
              dimensions: [
                { dimension: 'certainty', direction: 'increased' },
                { dimension: 'directness', direction: 'increased' },
              ],
            }),
          },
        }),
      ];
      const cases = [
        lockedCase({
          id: 'c1',
          humanDimensions: [
            { dimension: 'certainty', direction: 'increased' },
            { dimension: 'directness', direction: 'increased' },
          ],
        }),
      ];
      const stats = computeTrial4BenchmarkStats(results, cases);
      // base: TP=1 (certainty), FP=1 (formality), FN=1 (directness) -> P=0.5, R=0.5, F1=0.5
      expect(stats.base.dimensionMicroF1).toBeCloseTo(0.5, 5);
      // trained: TP=0, FP=0, FN=2 -> F1=0
      expect(stats.trained.dimensionMicroF1).toBe(0);
      // deepseek: exact match -> F1=1
      expect(stats.deepseek.dimensionMicroF1).toBe(1);
    });

    it('treats a locked case with humanDimensions: [] and no predicted dimensions as a vacuous perfect match', () => {
      const results = [
        result({
          judged: true,
          caseId: 'c1',
          labelMapping: {
            A: response('base', { dimensions: [] }),
            B: response('trained', { dimensions: [] }),
            C: response('deepseek', { dimensions: [] }),
          },
        }),
      ];
      const cases = [lockedCase({ id: 'c1', humanDimensions: [] })];
      const stats = computeTrial4BenchmarkStats(results, cases);
      expect(stats.base.dimensionExactSetAccuracy).toBe(1);
      expect(stats.base.dimensionMicroF1).toBe(1);
    });

    it('evaluates an "uncertain" ground truth normally on the verdict axis, expecting empty dimensions', () => {
      const results = [
        result({
          judged: true,
          caseId: 'c1',
          labelMapping: {
            A: response('base', { verdict: 'uncertain', dimensions: [] }),
            B: response('trained', { verdict: 'meaning_added', dimensions: [] }),
            C: response('deepseek', { verdict: 'uncertain', dimensions: [] }),
          },
        }),
      ];
      const cases = [lockedCase({ id: 'c1', humanVerdict: 'uncertain', humanDimensions: [] })];
      const stats = computeTrial4BenchmarkStats(results, cases);
      expect(stats.base.verdictAccuracy).toBe(1);
      expect(stats.trained.verdictAccuracy).toBe(0);
      expect(stats.base.dimensionExactSetAccuracy).toBe(1);
    });
  });
});
