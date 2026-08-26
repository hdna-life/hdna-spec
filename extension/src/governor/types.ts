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
   * Wall-clock milliseconds since the foreground last transitioned to
   * inactive; 0 while `foregroundActive` is true. Computed at the runtime
   * boundary (`background.ts`) from a *persisted* timestamp, not an
   * in-memory counter — an in-memory tick count cannot survive MV3
   * service-worker termination between dispatch alarms, which made
   * DEEP_IDLE unreachable in real Chrome even though it worked in
   * isolated tests. See docs/decisions/0014.
   */
  foregroundInactiveDurationMs: number;

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
}
