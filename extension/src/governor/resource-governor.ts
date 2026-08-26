import type { GovernorDecision, GovernorSignals, RuntimeMode } from './types';

const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 32;

/**
 * Consecutive idle ticks (foreground inactive) required before DEEP_IDLE is
 * selected. A placeholder tuning value, not derived from measurement: at
 * the current ~30s dispatch cadence this is roughly 90s of sustained
 * inactivity. The point is "sustained," not "instant" — the tick right
 * after the popup closes shouldn't immediately unlock P3 work while the
 * user might just be glancing away. See docs/decisions/0013.
 */
const DEEP_IDLE_AFTER_IDLE_TICKS = 3;

/**
 * Mode is a function of foreground activity/idleness only — never queue
 * backlog. A pending job (of any priority, P3 included) must never affect
 * which mode is selected, or a low-priority job can make itself permanently
 * ineligible to run: see docs/decisions/0013 for the P3-starvation bug this
 * fixes (DEEP_IDLE previously required queueBacklog === 0, so a lone
 * pending P3 job — itself keeping backlog > 0 — could never reach the only
 * mode allowed to dispatch it).
 */
function decideMode(foregroundActive: boolean, idleTicks: number): RuntimeMode {
  if (foregroundActive) return 'INTERACTIVE';
  if (idleTicks >= DEEP_IDLE_AFTER_IDLE_TICKS) return 'DEEP_IDLE';
  return 'BACKGROUND';
}

/**
 * Pure, deterministic scheduling decision: mode from foreground activity +
 * sustained idleness (see `decideMode`), batch size from observed job
 * latency (shrink when jobs run slower than expected, grow when
 * comfortably faster). No I/O, no WebGPU/battery/memory signals wired yet —
 * see GovernorSignals' SPEC_RESERVED fields.
 *
 * `previousIdleTicks` is threaded through the same way `previousBatchSize`
 * is — the caller carries `nextIdleTicks` forward to the next call. This
 * keeps `decide()` a pure function while still tracking idle duration
 * across ticks.
 */
export function decide(
  signals: GovernorSignals,
  previousBatchSize: number,
  previousIdleTicks: number,
): GovernorDecision {
  const idleTicks = signals.foregroundActive ? 0 : previousIdleTicks + 1;
  const mode = decideMode(signals.foregroundActive, idleTicks);

  if (mode === 'INTERACTIVE') {
    return { mode, nextBatchSize: MIN_BATCH_SIZE, nextIdleTicks: idleTicks };
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

  return { mode, nextBatchSize, nextIdleTicks: idleTicks };
}
