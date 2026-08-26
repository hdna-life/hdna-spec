import type { GovernorDecision, GovernorSignals, RuntimeMode } from './types';

const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 32;

/**
 * Wall-clock duration of sustained foreground inactivity required before
 * DEEP_IDLE is selected. A placeholder tuning value (90s), not derived from
 * measurement. Measured against a persisted timestamp at the runtime
 * boundary (`background.ts`), not an in-memory counter, so it survives MV3
 * service-worker termination between dispatch ticks — see
 * docs/decisions/0014 for why an earlier in-memory-tick-count version of
 * this threshold could never actually be reached in real Chrome.
 */
export const DEEP_IDLE_AFTER_INACTIVE_MS = 90_000;

/**
 * Mode is a function of foreground activity/idleness only — never queue
 * backlog. A pending job (of any priority, P3 included) must never affect
 * which mode is selected, or a low-priority job can make itself permanently
 * ineligible to run: see docs/decisions/0013 for the P3-starvation bug this
 * fixes (DEEP_IDLE previously required queueBacklog === 0, so a lone
 * pending P3 job — itself keeping backlog > 0 — could never reach the only
 * mode allowed to dispatch it).
 *
 * Exported separately from `decide()` so the runtime boundary can compute
 * the mode that gates *this* tick's dispatch before running anything —
 * `decide()`'s batch-size half needs this tick's measured latency, which
 * isn't known until after jobs run, but which priorities are even eligible
 * to run must be decided first. See docs/decisions/0014.
 */
export function decideMode(foregroundActive: boolean, inactiveDurationMs: number): RuntimeMode {
  if (foregroundActive) return 'INTERACTIVE';
  if (inactiveDurationMs >= DEEP_IDLE_AFTER_INACTIVE_MS) return 'DEEP_IDLE';
  return 'BACKGROUND';
}

/**
 * Pure, deterministic scheduling decision: mode from foreground activity +
 * sustained wall-clock idleness (see `decideMode`), batch size from
 * observed job latency (shrink when jobs run slower than expected, grow
 * when comfortably faster). No I/O, no WebGPU/battery/memory signals wired
 * yet — see GovernorSignals' SPEC_RESERVED fields.
 *
 * Deliberately stateless with respect to idleness: unlike batch size (which
 * genuinely needs to be threaded call-to-call), inactivity duration is
 * computed fresh each call from `signals.foregroundInactiveDurationMs`,
 * which the caller derives from a *persisted* timestamp — not carried as
 * decide()'s own state. This is what makes idleness tracking survive MV3
 * service-worker restarts: persistence/lifecycle concerns live at the
 * runtime boundary, not in this pure function. See docs/decisions/0014.
 */
export function decide(signals: GovernorSignals, previousBatchSize: number): GovernorDecision {
  const mode = decideMode(signals.foregroundActive, signals.foregroundInactiveDurationMs);

  if (mode === 'INTERACTIVE') {
    return { mode, nextBatchSize: MIN_BATCH_SIZE };
  }

  const ratio =
    signals.expectedJobLatencyMs > 0
      ? signals.lastJobLatencyMs / signals.expectedJobLatencyMs
      : 1;

  let nextBatchSize = previousBatchSize;
  if (ratio > 1.5) {
    nextBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(previousBatchSize / 2));
  } else if (ratio < 0.5) {
    nextBatchSize = Math.min(MAX_BATCH_SIZE, previousBatchSize * 2);
  }

  return { mode, nextBatchSize };
}
