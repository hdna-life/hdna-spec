import { describe, expect, it } from 'vitest';
import { decide } from '../../src/governor/resource-governor';
import type { GovernorSignals, RuntimeMode } from '../../src/governor/types';

const baseSignals: GovernorSignals = {
  queueBacklog: 5,
  lastJobLatencyMs: 100,
  expectedJobLatencyMs: 100,
  foregroundActive: false,
};

describe('resource governor decide()', () => {
  it('forces INTERACTIVE mode with minimum batch size when foreground is active', () => {
    const decision = decide({ ...baseSignals, foregroundActive: true }, 16, 0);
    expect(decision.mode).toBe('INTERACTIVE');
    expect(decision.nextBatchSize).toBe(1);
  });

  it('shrinks batch size when observed latency exceeds expectations', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 480, expectedJobLatencyMs: 120 }, 16, 0);
    expect(decision.nextBatchSize).toBe(8);
  });

  it('never shrinks below the minimum batch size', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 480, expectedJobLatencyMs: 120 }, 1, 0);
    expect(decision.nextBatchSize).toBe(1);
  });

  it('grows batch size when jobs run comfortably faster than expected', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 8, expectedJobLatencyMs: 120 }, 4, 0);
    expect(decision.nextBatchSize).toBe(8);
  });

  it('never grows past the maximum batch size', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 8, expectedJobLatencyMs: 120 }, 32, 0);
    expect(decision.nextBatchSize).toBe(32);
  });

  it('holds batch size steady when latency is within the tolerance band', () => {
    const decision = decide({ ...baseSignals, lastJobLatencyMs: 110, expectedJobLatencyMs: 120 }, 16, 0);
    expect(decision.nextBatchSize).toBe(16);
  });

  describe('mode selection is driven by foreground idleness, not queue backlog', () => {
    it('stays in BACKGROUND immediately after foreground goes idle, regardless of backlog', () => {
      // First idle tick — not yet "sustained" idleness.
      const decision = decide({ ...baseSignals, queueBacklog: 0 }, 4, 0);
      expect(decision.mode).toBe('BACKGROUND');
      expect(decision.nextIdleTicks).toBe(1);
    });

    it('reaches DEEP_IDLE only after enough consecutive idle ticks, with a nonzero backlog', () => {
      // A P3 job is pending the whole time (queueBacklog stays >= 1) — this
      // must not prevent DEEP_IDLE from ever being reached.
      let idleTicks = 0;
      let mode: RuntimeMode = 'BACKGROUND';
      for (let tick = 0; tick < 5; tick += 1) {
        const decision = decide({ ...baseSignals, queueBacklog: 1 }, 4, idleTicks);
        idleTicks = decision.nextIdleTicks;
        mode = decision.mode;
      }
      expect(mode).toBe('DEEP_IDLE');
    });

    it('resets idle ticks and returns to INTERACTIVE the instant foreground becomes active again', () => {
      const idleDecision = decide({ ...baseSignals, queueBacklog: 1 }, 4, 5);
      expect(idleDecision.mode).toBe('DEEP_IDLE');

      const activeDecision = decide({ ...baseSignals, queueBacklog: 1, foregroundActive: true }, 4, idleDecision.nextIdleTicks);
      expect(activeDecision.mode).toBe('INTERACTIVE');
      expect(activeDecision.nextIdleTicks).toBe(0);
    });
  });

  describe('P3-starvation regression (docs/decisions/0013)', () => {
    it('a lone pending P3 job (queueBacklog === 1 forever, since nothing dispatches it) eventually reaches DEEP_IDLE once foreground is inactive', () => {
      // Simulates the reported bug exactly: a single P3 job sits in the
      // queue every tick (nothing else runs it, since only DEEP_IDLE may
      // dispatch P3), foreground never becomes active again. Before the
      // fix, DEEP_IDLE required queueBacklog === 0, which this backlog
      // value can never satisfy — permanent BACKGROUND, permanent
      // starvation. After the fix, DEEP_IDLE must be reached anyway.
      let idleTicks = 0;
      let mode: RuntimeMode = 'BACKGROUND';
      for (let tick = 0; tick < 10; tick += 1) {
        const decision = decide({ ...baseSignals, queueBacklog: 1, foregroundActive: false }, 4, idleTicks);
        idleTicks = decision.nextIdleTicks;
        mode = decision.mode;
        if (mode === 'DEEP_IDLE') break;
      }
      expect(mode).toBe('DEEP_IDLE');
    });

    it('P3 still never runs while INTERACTIVE, no matter how long the job has been pending', () => {
      // Idle ticks accumulated, then foreground becomes active again with
      // the same P3 job still sitting in the backlog — must snap back to
      // INTERACTIVE immediately, not stay in DEEP_IDLE because of the
      // pending job.
      const decision = decide({ ...baseSignals, queueBacklog: 1, foregroundActive: true }, 4, 9);
      expect(decision.mode).toBe('INTERACTIVE');
    });

    it('P3 does not run in BACKGROUND either (checked via ALLOWED_PRIORITIES_BY_MODE, not decide() directly)', async () => {
      const { ALLOWED_PRIORITIES_BY_MODE } = await import('../../src/governor/mode-priorities');
      expect(ALLOWED_PRIORITIES_BY_MODE.BACKGROUND).not.toContain('P3');
      expect(ALLOWED_PRIORITIES_BY_MODE.INTERACTIVE).not.toContain('P3');
      expect(ALLOWED_PRIORITIES_BY_MODE.DEEP_IDLE).toContain('P3');
    });
  });
});
