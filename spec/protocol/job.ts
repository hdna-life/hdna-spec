/**
 * Job queue protocol, per the design doc's "Queue classes" section.
 * P0 immediate/cheap ... P3 expensive/rare.
 */

export type JobPriority = 'P0' | 'P1' | 'P2' | 'P3';

export const JOB_PRIORITY_ORDER: readonly JobPriority[] = ['P0', 'P1', 'P2', 'P3'];

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED';

export interface Job<TPayload = unknown> {
  id: string;
  priority: JobPriority;
  type: string;
  payload: TPayload;
  status: JobStatus;
  createdAt: string;
  /**
   * Monotonically increasing enqueue order, scoped to this queue's storage.
   * The actual FIFO tiebreaker within a priority class — `createdAt` is
   * millisecond-resolution and can collide for near-simultaneous enqueues,
   * and storage retrieval order is not guaranteed to match insertion order.
   */
  sequence: number;
  attempts: number;
  lastError?: string;
  /**
   * Set when the job transitions to RUNNING; cleared when it leaves RUNNING
   * (reclaimed, completed, or failed). Used as the lease timestamp for
   * stale-RUNNING recovery — see JobQueue's reclaim logic.
   */
  startedAt?: string;
}
