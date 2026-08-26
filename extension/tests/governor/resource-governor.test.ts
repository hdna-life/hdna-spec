import { describe, expect, it } from 'vitest';
import { decide } from '../../src/governor/resource-governor';
import type { GovernorSignals } from '../../src/governor/types';

const baseSignals: GovernorSignals = {
  queueBacklog: 5,
  lastJobLatencyMs: 100,
  expectedJobLatencyMs: 100,
  foregroundActive: false,
};

describe('resource governor decide()', () => {
  it('forces INTERACTIVE mode with minimum batch size when foreground is active', () => {
    const decision = decide({ ...baseSignals, foregroundActive: true }, 16);
    expect(decision.mode).toBe('INTERACTIVE');
    expect(decision.nextBatchSize).toBe(1);
  });

  it('shrinks batch size when observed latency exceeds expectations', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 480, expectedJobLatencyMs: 120 }, 16);
    expect(decision.nextBatchSize).toBe(8);
  });

  it('never shrinks below the minimum batch size', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 480, expectedJobLatencyMs: 120 }, 1);
    expect(decision.nextBatchSize).toBe(1);
  });

  it('grows batch size when jobs run comfortably faster than expected', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 8, expectedJobLatencyMs: 120 }, 4);
    expect(decision.nextBatchSize).toBe(8);
  });

  it('never grows past the maximum batch size', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 8, expectedJobLatencyMs: 120 }, 32);
    expect(decision.nextBatchSize).toBe(32);
  });

  it('holds batch size steady when latency is within the tolerance band', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 110, expectedJobLatencyMs: 120 }, 16);
    expect(decision.nextBatchSize).toBe(16);
  });

  it('reports DEEP_IDLE when the queue is empty and no foreground activity', () => {
    const decision = decide({ ...baseSignals, queueBacklog: 0 }, 4);
    expect(decision.mode).toBe('DEEP_IDLE');
  });

  it('reports BACKGROUND when jobs are queued and no foreground activity', () => {
    const decision = decide({ ...baseSignals, queueBacklog: 3 }, 4);
    expect(decision.mode).toBe('BACKGROUND');
  });
});
