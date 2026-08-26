export type RuntimeMode = 'INTERACTIVE' | 'BACKGROUND' | 'DEEP_IDLE';

export interface GovernorSignals {
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
}
