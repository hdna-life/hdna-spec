import { describe, expect, it } from 'vitest';
import { DEEP_IDLE_AFTER_INACTIVE_MS, decide, decideMode } from '../../src/governor/resource-governor';
import type { GovernorSignals } from '../../src/governor/types';

const baseSignals: GovernorSignals = {
  queueBacklog: 5,
  lastJobLatencyMs: 100,
  expectedJobLatencyMs: 100,
  foregroundActive: false,
  foregroundInactiveDurationMs: 0,
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
});

describe('decideMode() — wall-clock idleness, not queue backlog, not in-memory ticks', () => {
  it('is INTERACTIVE whenever foreground is active, regardless of inactive duration', () => {
    expect(decideMode(true, 0)).toBe('INTERACTIVE');
    expect(decideMode(true, DEEP_IDLE_AFTER_INACTIVE_MS * 10)).toBe('INTERACTIVE');
  });

  it('is BACKGROUND immediately after foreground goes inactive (duration 0)', () => {
    expect(decideMode(false, 0)).toBe('BACKGROUND');
  });

  it('stays BACKGROUND until the inactive-duration threshold is crossed', () => {
    expect(decideMode(false, DEEP_IDLE_AFTER_INACTIVE_MS - 1)).toBe('BACKGROUND');
  });

  it('reaches DEEP_IDLE once the inactive-duration threshold is crossed', () => {
    expect(decideMode(false, DEEP_IDLE_AFTER_INACTIVE_MS)).toBe('DEEP_IDLE');
    expect(decideMode(false, DEEP_IDLE_AFTER_INACTIVE_MS + 60_000)).toBe('DEEP_IDLE');
  });

  it('reaches DEEP_IDLE regardless of queue backlog — decideMode has no backlog parameter at all', () => {
    // The signature itself (foregroundActive, inactiveDurationMs) is the
    // regression guard for docs/decisions/0013: there is no way to pass a
    // backlog value into this function, so it cannot influence the result.
    expect(decideMode(false, DEEP_IDLE_AFTER_INACTIVE_MS)).toBe('DEEP_IDLE');
  });
});

describe('P3-starvation regression, MV3-lifecycle-accurate (docs/decisions/0014)', () => {
  it('a lone pending P3 job eventually becomes eligible (DEEP_IDLE) purely from elapsed wall-clock time, simulating a service worker restarting between every tick', () => {
    // No in-memory state is carried between iterations here at all — each
    // iteration re-derives inactiveDurationMs from an elapsed-time value
    // the way background.ts would after re-reading a persisted timestamp
    // from storage on a freshly restarted service worker. If mode were
    // still derived from an in-memory tick counter (the pre-0014 bug),
    // this loop could never reach DEEP_IDLE, since idleTicks would reset to
    // 0 on every "restart" and never accumulate.
    const tickIntervalMs = 30_000;
    let mode: ReturnType<typeof decideMode> = 'BACKGROUND';
    for (let tick = 1; tick <= 10; tick += 1) {
      // Simulates: worker restarted, re-read foregroundInactiveSince from
      // storage, computed elapsed time fresh — never an in-memory counter.
      const inactiveDurationMs = tick * tickIntervalMs;
      mode = decideMode(false, inactiveDurationMs);
      if (mode === 'DEEP_IDLE') break;
    }
    expect(mode).toBe('DEEP_IDLE');
  });

  it('P3 never runs while INTERACTIVE, no matter how long a job has been pending or how long foreground was previously inactive', () => {
    // Foreground reactivating must override any accumulated inactive
    // duration immediately.
    expect(decideMode(true, DEEP_IDLE_AFTER_INACTIVE_MS * 5)).toBe('INTERACTIVE');
  });

  it('P0-P2 job dispatch is unaffected: BACKGROUND is reached identically to before this fix for short inactivity', () => {
    expect(decideMode(false, 1_000)).toBe('BACKGROUND');
  });

  it('a permanently pending P3 job cannot keep itself permanently ineligible — decideMode never reads queue state', () => {
    // decideMode's signature (foregroundActive, inactiveDurationMs) has no
    // path for a caller to feed in "this job has been pending forever" as
    // a reason to stay out of DEEP_IDLE. Structurally guaranteed, not just
    // empirically observed.
    expect(decideMode.length).toBe(2);
    expect(decideMode(false, DEEP_IDLE_AFTER_INACTIVE_MS)).toBe('DEEP_IDLE');
  });
});
