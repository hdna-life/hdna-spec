import type { Job, JobPriority } from '@spec/protocol/job';
import { JOB_PRIORITY_ORDER } from '@spec/protocol/job';
import type { StorageAdapter } from '../storage/types';

const JOB_STORE = 'jobs';

export type JobProcessor<TPayload = unknown> = (payload: TPayload) => Promise<void>;

/**
 * Persistent job queue. Persists every job through the StorageAdapter so
 * queued work survives MV3 service-worker termination.
 */
export class JobQueue {
  private processors = new Map<string, JobProcessor>();

  constructor(private storage: StorageAdapter) {}

  registerProcessor<TPayload>(type: string, processor: JobProcessor<TPayload>): void {
    this.processors.set(type, processor as JobProcessor);
  }

  async enqueue<TPayload>(type: string, priority: JobPriority, payload: TPayload): Promise<Job<TPayload>> {
    const job: Job<TPayload> = {
      id: crypto.randomUUID(),
      priority,
      type,
      payload,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await this.storage.put(JOB_STORE, job.id, job, 'CANONICAL');
    return job;
  }

  /** Returns the highest-priority pending job (P0 first), FIFO within a priority class. */
  async next(): Promise<Job | undefined> {
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const pending = jobs.filter((j) => j.status === 'PENDING');
    pending.sort((a, b) => {
      const priorityDiff = JOB_PRIORITY_ORDER.indexOf(a.priority) - JOB_PRIORITY_ORDER.indexOf(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.localeCompare(b.createdAt);
    });
    return pending[0];
  }

  async countsByPriority(): Promise<Record<JobPriority, number>> {
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const counts = Object.fromEntries(JOB_PRIORITY_ORDER.map((p) => [p, 0])) as Record<JobPriority, number>;
    for (const job of jobs) {
      if (job.status === 'PENDING') counts[job.priority] += 1;
    }
    return counts;
  }

  /** Runs the next pending job, if any, using its registered processor. Returns the job outcome, or undefined if the queue was empty. */
  async runNext(): Promise<Job | undefined> {
    const job = await this.next();
    if (!job) return undefined;

    job.status = 'RUNNING';
    job.attempts += 1;
    await this.storage.put(JOB_STORE, job.id, job, 'CANONICAL');

    const processor = this.processors.get(job.type);
    try {
      if (!processor) throw new Error(`No processor registered for job type "${job.type}"`);
      await processor(job.payload);
      job.status = 'COMPLETE';
    } catch (err) {
      job.status = 'FAILED';
      job.lastError = err instanceof Error ? err.message : String(err);
    }
    await this.storage.put(JOB_STORE, job.id, job, 'CANONICAL');
    return job;
  }
}
