import type { GovernorDecision, GovernorSignals, RuntimeMode } from './types';

const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 32;
const BACKLOG_DEEP_IDLE_THRESHOLD = 0;
const BACKLOG_BACKGROUND_THRESHOLD = 1;

function decideMode(signals: GovernorSignals): RuntimeMode {
  if (signals.foregroundActive) return 'INTERACTIVE';
  if (signals.queueBacklog <= BACKLOG_DEEP_IDLE_THRESHOLD) return 'DEEP_IDLE';
  if (signals.queueBacklog >= BACKLOG_BACKGROUND_THRESHOLD) return 'BACKGROUND';
  return 'BACKGROUND';
}

/**
 * Pure, deterministic batch-size adaptation: shrink the batch when observed
 * job latency exceeds expectations, grow it when jobs run comfortably faster
 * than expected. No I/O, no WebGPU/battery/memory signals wired yet — see
 * GovernorSignals' SPEC_RESERVED fields.
 */
export function decide(signals: GovernorSignals, previousBatchSize: number): GovernorDecision {
  const mode = decideMode(signals);

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
