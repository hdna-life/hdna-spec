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
  attempts: number;
  lastError?: string;
}
