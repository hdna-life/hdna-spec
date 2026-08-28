import type { Job, JobPriority } from '@spec/protocol/job';
import { JOB_PRIORITY_ORDER } from '@spec/protocol/job';
import type { StorageAdapter } from '../storage/types';

export const JOB_STORE = 'jobs';

/** RUNNING longer than this with no completion is assumed to mean the service worker died mid-job, not that it's still working. */
export const DEFAULT_STALE_RUNNING_TIMEOUT_MS = 5 * 60 * 1000;

export type JobProcessor<TPayload = unknown> = (payload: TPayload) => Promise<void>;

/**
 * Persistent, at-least-once job queue. Persists every job through the
 * StorageAdapter so queued work survives MV3 service-worker termination —
 * including a job caught mid-execution: a RUNNING job whose lease
 * (`startedAt`) has expired is reclaimed back to PENDING and retried. Because
 * this is at-least-once (not exactly-once), processors must be idempotent —
 * a reclaimed job may run its side effects more than once.
 */
export class JobQueue {
  private processors = new Map<string, JobProcessor>();
  /** Lazily initialized from persisted jobs so ordering stays correct across service-worker restarts. */
  private nextSequence: number | undefined;

  constructor(
    private storage: StorageAdapter,
    private staleRunningTimeoutMs = DEFAULT_STALE_RUNNING_TIMEOUT_MS,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  registerProcessor<TPayload>(type: string, processor: JobProcessor<TPayload>): void {
    this.processors.set(type, processor as JobProcessor);
  }

  private async allocateSequence(): Promise<number> {
    if (this.nextSequence === undefined) {
      const jobs = await this.storage.query<Job>(JOB_STORE);
      const maxSequence = jobs.reduce((max, j) => Math.max(max, j.sequence ?? -1), -1);
      this.nextSequence = maxSequence + 1;
    }
    return this.nextSequence++;
  }

  async enqueue<TPayload>(type: string, priority: JobPriority, payload: TPayload): Promise<Job<TPayload>> {
    const job: Job<TPayload> = {
      id: crypto.randomUUID(),
      priority,
      type,
      payload,
      status: 'PENDING',
      createdAt: this.now(),
      sequence: await this.allocateSequence(),
      attempts: 0,
    };
    await this.storage.put(JOB_STORE, job.id, job, 'CANONICAL');
    return job;
  }

  /**
   * Enqueues a job of `type` only if none is currently outstanding
   * (`PENDING` or `RUNNING`) — otherwise returns the existing outstanding
   * job unchanged, with no new job created. For coalescable singleton work
   * (a full rebuild/recompile that repeated triggers — e.g. a user clicking
   * a "Rebuild" button multiple times — shouldn't queue up N duplicate
   * copies of). `COMPLETE`/`FAILED` jobs don't count as outstanding, so a
   * fresh trigger after completion (or after a failure) always creates a
   * new job normally. Keyed by job `type` alone, generic across any job
   * type — not specific to any one rebuild job. See docs/decisions/0014.
   *
   * Reclaims stale RUNNING jobs FIRST (same lease check `next()` uses) —
   * without this, a job whose processor never got to flip it to
   * COMPLETE/FAILED (the MV3 service worker was terminated mid-`await`,
   * which real Chrome does to long-running event handlers) stays
   * "outstanding" forever: every future click of the button that calls
   * this method would keep returning that same dead job, never creating a
   * new one, and the operator would see the button silently do nothing —
   * indistinguishable from a real deadlock, because it is one.
   */
  async enqueueSingleton<TPayload>(type: string, priority: JobPriority, payload: TPayload): Promise<Job<TPayload>> {
    await this.reclaimStaleJobs();
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const outstanding = jobs.find((j) => j.type === type && (j.status === 'PENDING' || j.status === 'RUNNING'));
    if (outstanding) return outstanding as Job<TPayload>;
    return this.enqueue(type, priority, payload);
  }

  /** Flips any RUNNING job whose lease has expired back to PENDING, clearing startedAt. */
  private async reclaimStaleJobs(): Promise<void> {
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const nowMs = Date.parse(this.now());

    for (const job of jobs) {
      if (job.status !== 'RUNNING' || !job.startedAt) continue;
      if (nowMs - Date.parse(job.startedAt) <= this.staleRunningTimeoutMs) continue;

      const reclaimed: Job = { ...job, status: 'PENDING', startedAt: undefined };
      await this.storage.put(JOB_STORE, reclaimed.id, reclaimed, 'CANONICAL');
    }
  }

  /**
   * Returns the highest-priority pending job (P0 first), FIFO within a
   * priority class. Reclaims stale RUNNING jobs first. When
   * `allowedPriorities` is given, jobs outside that set are left PENDING and
   * ignored — e.g. the runtime governor restricting dispatch to cheap job
   * classes while the user is actively interacting.
   */
  async next(allowedPriorities?: JobPriority[]): Promise<Job | undefined> {
    await this.reclaimStaleJobs();

    const allowedSet = allowedPriorities ? new Set(allowedPriorities) : undefined;
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const pending = jobs.filter((j) => j.status === 'PENDING' && (!allowedSet || allowedSet.has(j.priority)));
    pending.sort((a, b) => {
      const priorityDiff = JOB_PRIORITY_ORDER.indexOf(a.priority) - JOB_PRIORITY_ORDER.indexOf(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return a.sequence - b.sequence;
    });
    return pending[0];
  }

  /**
   * Reclaims stale RUNNING jobs first — `background.ts`'s dispatch tick
   * uses this count's total to decide whether there is anything to do at
   * all, and early-returns without ever calling `next()`/`runNext()` when
   * it's zero. A job stuck RUNNING past its lease (service worker killed
   * mid-`await`) is invisible to a status filter that only counts PENDING,
   * so without this reclaim call here, that dispatch tick's early-return
   * would silently skip the ONE place that would otherwise reclaim it
   * (`next()`) — permanently, since a zero-backlog tick never gets there.
   * See `enqueueSingleton`'s docstring for the matching half of this fix.
   */
  async countsByPriority(): Promise<Record<JobPriority, number>> {
    await this.reclaimStaleJobs();
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const counts = Object.fromEntries(JOB_PRIORITY_ORDER.map((p) => [p, 0])) as Record<JobPriority, number>;
    for (const job of jobs) {
      if (job.status === 'PENDING') counts[job.priority] += 1;
    }
    return counts;
  }

  /**
   * Every persisted job of `type`, sorted oldest-to-newest (by `sequence`,
   * the actual FIFO order — see `Job.sequence`'s docstring). Read-only —
   * for a UI to surface a job's real status/lastError to the operator (a
   * FAILED job with a clear error message is silent otherwise: it simply
   * never runs again on its own, and nothing else in this class exposes
   * why). Not filtered by status; callers that only want the latest
   * outcome should take the last element.
   */
  async listByType(type: string): Promise<Job[]> {
    const jobs = await this.storage.query<Job>(JOB_STORE);
    return jobs.filter((j) => j.type === type).sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Marks every currently outstanding (`PENDING` or `RUNNING`) job of
   * `type` as `FAILED` with `lastError` set to `reason`, immediately —
   * an explicit operator escape hatch for the case `reclaimStaleJobs`
   * already fixes automatically but only after
   * `staleRunningTimeoutMs` (5 minutes by default) has elapsed. Without
   * this, an operator staring at a job legitimately stuck RUNNING (the
   * service worker was killed mid-`await` — long local-model inference
   * calls are exactly the kind of work that can outlive a single MV3
   * event-handler execution window) has no way to unblock
   * `enqueueSingleton` sooner than that timeout; every retry click keeps
   * returning the same dead job. Returns the number of jobs affected.
   * Does not touch `COMPLETE`/`FAILED` jobs — nothing to cancel there.
   */
  async cancelOutstanding(type: string, reason: string): Promise<number> {
    const jobs = await this.storage.query<Job>(JOB_STORE);
    const outstanding = jobs.filter((j) => j.type === type && (j.status === 'PENDING' || j.status === 'RUNNING'));
    for (const job of outstanding) {
      const cancelled: Job = { ...job, status: 'FAILED', lastError: reason, startedAt: undefined };
      await this.storage.put(JOB_STORE, cancelled.id, cancelled, 'CANONICAL');
    }
    return outstanding.length;
  }

  /** Runs the next pending job (optionally restricted to `allowedPriorities`), if any, using its registered processor. Returns the job outcome, or undefined if there was nothing eligible. */
  async runNext(allowedPriorities?: JobPriority[]): Promise<Job | undefined> {
    const job = await this.next(allowedPriorities);
    if (!job) return undefined;

    job.status = 'RUNNING';
    job.startedAt = this.now();
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
