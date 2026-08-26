import { describe, expect, it } from 'vitest';
import { computeForegroundInactivity } from '../../src/runtime/foreground-inactivity';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');

describe('computeForegroundInactivity', () => {
  it('clears the persisted timestamp and reports 0 duration while foreground is active', () => {
    const result = computeForegroundInactivity('2025-12-31T23:00:00.000Z', true, T0);
    expect(result).toEqual({ foregroundInactiveSince: undefined, inactiveDurationMs: 0 });
  });

  it('starts a fresh timestamp the first time foreground is observed inactive (no prior persisted value)', () => {
    const result = computeForegroundInactivity(undefined, false, T0);
    expect(result.foregroundInactiveSince).toBe(new Date(T0).toISOString());
    expect(result.inactiveDurationMs).toBe(0);
  });

  it('keeps the existing persisted timestamp unchanged while inactivity continues, and derives duration from it', () => {
    const since = new Date(T0).toISOString();
    const laterNowMs = T0 + 45_000;
    const result = computeForegroundInactivity(since, false, laterNowMs);
    expect(result.foregroundInactiveSince).toBe(since);
    expect(result.inactiveDurationMs).toBe(45_000);
  });

  it('does not depend on any in-memory state across calls — repeated independent calls with the same persisted value agree', () => {
    // Each call here is independent, deliberately not threading any state
    // forward except through the explicit previousInactiveSince argument —
    // simulating a fresh service-worker instance re-reading storage on
    // every call, the way background.ts does after an MV3 restart.
    const since = new Date(T0).toISOString();
    const a = computeForegroundInactivity(since, false, T0 + 60_000);
    const b = computeForegroundInactivity(since, false, T0 + 60_000);
    expect(a).toEqual(b);
  });

  it('is a pure function of its arguments: identical inputs always produce identical outputs', () => {
    const since = new Date(T0).toISOString();
    expect(computeForegroundInactivity(since, false, T0 + 12_345)).toEqual(
      computeForegroundInactivity(since, false, T0 + 12_345),
    );
  });
});
