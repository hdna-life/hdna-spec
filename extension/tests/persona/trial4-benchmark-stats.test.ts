import { describe, expect, it } from 'vitest';
import { computeTrial4BenchmarkStats } from '../../src/persona/trial4-benchmark-stats';
import type { Trial4BenchmarkResponse, Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';

function response(role: Trial4BenchmarkResponse['role'], overrides: Partial<Trial4BenchmarkResponse> = {}): Trial4BenchmarkResponse {
  return { role, verdict: 'meaning_transformed', description: 'x', confidence: 0.7, error: null, grade: null, ...overrides };
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

describe('computeTrial4BenchmarkStats', () => {
  it('returns all-zero stats for an empty result set', () => {
    const stats = computeTrial4BenchmarkStats([]);
    expect(stats.base.judgedCount).toBe(0);
    expect(stats.base.correctRate).toBe(0);
    expect(stats.trainedVsBaseImprovement).toBe(0);
    expect(stats.judgedResultCount).toBe(0);
    expect(stats.totalResultCount).toBe(0);
  });

  it('ignores unjudged results entirely', () => {
    const results = [result({ judged: false })];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.judgedResultCount).toBe(0);
    expect(stats.totalResultCount).toBe(1);
    expect(stats.base.judgedCount).toBe(0);
  });

  it('counts correct/partial/wrong per role, independent of which label the role landed on', () => {
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

  it('computes correctRate as correct / judgedCount', () => {
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

  it('computes trainedVsBaseImprovement as trained.correctRate - base.correctRate (can be negative)', () => {
    const results = [
      result({
        judged: true,
        labelMapping: {
          A: response('base', { grade: 'correct' }),
          B: response('trained', { grade: 'wrong' }),
          C: response('deepseek', { grade: 'correct' }),
        },
      }),
    ];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.trainedVsBaseImprovement).toBeCloseTo(0 - 1, 5);
  });

  it('counts a role error separately from a wrong grade, and does not count it toward judgedCount', () => {
    const results = [
      result({
        judged: true,
        labelMapping: {
          A: response('base', { grade: null, error: 'Local MLX server unreachable', verdict: null }),
          B: response('trained', { grade: 'correct' }),
          C: response('deepseek', { grade: 'correct' }),
        },
      }),
    ];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.base.errors).toBe(1);
    expect(stats.base.judgedCount).toBe(0);
    expect(stats.base.wrong).toBe(0);
  });

  it('counts win rates from bestResponse, resolved to the winning role', () => {
    const results = [
      result({ judged: true, bestResponse: 'A', labelMapping: { A: response('trained'), B: response('base'), C: response('deepseek') } }),
      result({ judged: true, bestResponse: 'B', labelMapping: { A: response('base'), B: response('deepseek'), C: response('trained') } }),
      result({ judged: true, bestResponse: 'tie', labelMapping: { A: response('base'), B: response('trained'), C: response('deepseek') } }),
    ];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.winCounts.trained).toBe(1);
    expect(stats.winCounts.deepseek).toBe(1);
    expect(stats.winCounts.base).toBe(0);
    expect(stats.tieCount).toBe(1);
  });

  it('does not count a null bestResponse (judged but not yet resolved) as a win or tie', () => {
    const results = [result({ judged: true, bestResponse: null })];
    const stats = computeTrial4BenchmarkStats(results);
    expect(stats.winCounts.base + stats.winCounts.trained + stats.winCounts.deepseek + stats.tieCount).toBe(0);
  });
});
