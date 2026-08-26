export type RuntimeMode = 'INTERACTIVE' | 'BACKGROUND' | 'DEEP_IDLE';

export interface GovernorSignals {
  /**
   * Total pending job count across all priorities. Tracked per the design
   * doc's governor-signals list, but NOT used to select `RuntimeMode` — see
   * docs/decisions/0013: gating DEEP_IDLE on an empty queue made any
   * pending low-priority (P3) job self-blocking, since its own presence in
   * the backlog prevented the only mode allowed to run it. Mode is derived
   * from foreground activity/idleness alone; this field remains available
   * for batch-size-adjacent uses.
   */
  queueBacklog: number;
  lastJobLatencyMs: number;
  expectedJobLatencyMs: number;
  foregroundActive: boolean;

  /**
   * SPEC_RESERVED hooks — typed now so the governor's decision function
   * signature doesn't need to change when these signals become available,
   * but intentionally unwired: there is no WebGPU or model work in the MVP
   * foundation for them to govern, and Chrome's battery API is effectively
   * unavailable/deprecated.
   */
  webgpuContention?: boolean;
  batteryLevel?: number;
  memoryPressure?: 'nominal' | 'moderate' | 'critical';
}

export interface GovernorDecision {
  mode: RuntimeMode;
  /** Recommended batch size for the next job class run, derived from latency ratio. */
  nextBatchSize: number;
  /**
   * Consecutive dispatch ticks with the foreground inactive, carried forward
   * across calls (0 while foreground is active) — the state DEEP_IDLE is
   * derived from. See docs/decisions/0013 for why this replaced queue
   * backlog as the DEEP_IDLE signal.
   */
  nextIdleTicks: number;
}
