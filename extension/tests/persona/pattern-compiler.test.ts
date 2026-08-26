import { describe, expect, it } from 'vitest';
import { aggregateObservations, type ScoredObservation } from '../../src/persona/pattern-compiler';
import type { PatternCompilerPolicy } from '@spec/schema/pattern-compiler-policy';

const POLICY: PatternCompilerPolicy = { minSampleCount: 3, minConfidenceWeight: 1.5 };

function obs(overrides: Partial<ScoredObservation> = {}): ScoredObservation {
  return { dimension: 'formality', context: 'unscoped', value: 0.5, confidence: 1, recordId: 'x:1', ...overrides };
}

describe('aggregateObservations', () => {
  it('emits nothing below the sample-count threshold', () => {
    const observations = [obs(), obs()]; // only 2, threshold is 3
    expect(aggregateObservations(observations, POLICY)).toEqual([]);
  });

  it('emits nothing below the confidence-weight threshold even with enough samples', () => {
    const observations = [obs({ confidence: 0.1 }), obs({ confidence: 0.1 }), obs({ confidence: 0.1 })]; // 0.3 total < 1.5
    expect(aggregateObservations(observations, POLICY)).toEqual([]);
  });

  it('emits a Pattern once both thresholds are crossed, with a confidence-weighted mean', () => {
    const observations = [
      obs({ value: 1.0, confidence: 1 }),
      obs({ value: 0.0, confidence: 1 }),
      obs({ value: 0.5, confidence: 1 }),
    ];
    const [pattern] = aggregateObservations(observations, POLICY, () => '2026-01-01T00:00:00.000Z');

    expect(pattern.dimension).toBe('formality');
    expect(pattern.context).toBe('unscoped');
    expect(pattern.value).toBeCloseTo(0.5, 10);
    expect(pattern.confidenceWeight).toBe(3);
    expect(pattern.sampleCount).toBe(3);
    expect(pattern.computedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('weights higher-confidence observations more heavily', () => {
    const observations = [
      obs({ value: 1.0, confidence: 1.0 }),
      obs({ value: 0.0, confidence: 0.1 }),
      obs({ value: 1.0, confidence: 1.0 }),
    ];
    const [pattern] = aggregateObservations(observations, POLICY);
    // (1*1 + 0*0.1 + 1*1) / (1 + 0.1 + 1) = 2 / 2.1
    expect(pattern.value).toBeCloseTo(2 / 2.1, 10);
  });

  it('groups separately by context, even for the same dimension', () => {
    const observations = [
      obs({ context: 'public', value: 0.9 }),
      obs({ context: 'public', value: 0.9 }),
      obs({ context: 'public', value: 0.9 }),
      obs({ context: 'private', value: 0.1 }),
      obs({ context: 'private', value: 0.1 }),
      obs({ context: 'private', value: 0.1 }),
    ];
    const patterns = aggregateObservations(observations, POLICY);
    expect(patterns).toHaveLength(2);
    const byContext = Object.fromEntries(patterns.map((p) => [p.context, p.value]));
    expect(byContext.public).toBeCloseTo(0.9, 10);
    expect(byContext.private).toBeCloseTo(0.1, 10);
  });

  it('groups separately by dimension, even within the same context', () => {
    const observations = [
      obs({ dimension: 'formality', value: 0.8 }),
      obs({ dimension: 'formality', value: 0.8 }),
      obs({ dimension: 'formality', value: 0.8 }),
      obs({ dimension: 'directness', value: 0.2 }),
      obs({ dimension: 'directness', value: 0.2 }),
      obs({ dimension: 'directness', value: 0.2 }),
    ];
    const patterns = aggregateObservations(observations, POLICY);
    expect(patterns).toHaveLength(2);
  });

  it('lists every contributing record id as supporting evidence', () => {
    const observations = [obs({ recordId: 'a' }), obs({ recordId: 'b' }), obs({ recordId: 'c' })];
    const [pattern] = aggregateObservations(observations, POLICY);
    expect(pattern.supportingRecordIds).toEqual(['a', 'b', 'c']);
  });

  it('stamps compiler identity metadata', () => {
    const observations = [obs(), obs(), obs()];
    const [pattern] = aggregateObservations(observations, POLICY);
    expect(pattern.compilerId).toBe('deterministic-aggregate');
    expect(pattern.compilerVersion).toBe('1.0.0');
  });

  it('returns an empty array for no observations', () => {
    expect(aggregateObservations([], POLICY)).toEqual([]);
  });
});
