import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JOB_STORE, JobQueue } from '../../src/queue/job-queue';
import { noopProcessor } from '../../src/queue/processors/noop-processor';
import type { Job } from '@spec/protocol/job';

function stuckRunningJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'stuck-job',
    priority: 'P0',
    type: 'noop',
    payload: {},
    status: 'RUNNING',
    createdAt: '2026-01-01T00:00:00.000Z',
    sequence: 0,
    attempts: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobQueue', () => {
  let queue: JobQueue;

  beforeEach(() => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    queue = new JobQueue(adapter);
    queue.registerProcessor('noop', noopProcessor);
  });

  it('runs jobs in priority order, P0 before P3', async () => {
    await queue.enqueue('noop', 'P3', { n: 1 });
    await queue.enqueue('noop', 'P0', { n: 2 });
    await queue.enqueue('noop', 'P1', { n: 3 });

    const first = await queue.runNext();
    const second = await queue.runNext();
    const third = await queue.runNext();

    expect(first?.priority).toBe('P0');
    expect(second?.priority).toBe('P1');
    expect(third?.priority).toBe('P3');
  });

  it('orders jobs within the same priority class FIFO', async () => {
    const jobA = await queue.enqueue('noop', 'P1', { order: 'a' });
    const jobB = await queue.enqueue('noop', 'P1', { order: 'b' });

    const first = await queue.runNext();
    const second = await queue.runNext();

    expect(first?.id).toBe(jobA.id);
    expect(second?.id).toBe(jobB.id);
  });

  it('preserves FIFO order even when createdAt timestamps collide (regression)', async () => {
    // A fixed clock simulates two enqueue calls landing in the same
    // millisecond — createdAt alone can't break the tie; sequence must.
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const fixedClock = new JobQueue(adapter, undefined, () => '2026-01-01T00:00:00.000Z');
    fixedClock.registerProcessor('noop', noopProcessor);

    const jobA = await fixedClock.enqueue('noop', 'P1', { order: 'a' });
    const jobB = await fixedClock.enqueue('noop', 'P1', { order: 'b' });
    expect(jobA.createdAt).toBe(jobB.createdAt);

    const first = await fixedClock.runNext();
    const second = await fixedClock.runNext();
    expect(first?.id).toBe(jobA.id);
    expect(second?.id).toBe(jobB.id);
  });

  it('resumes the sequence counter correctly for a new JobQueue instance sharing storage', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queueA = new JobQueue(adapter);
    await queueA.enqueue('noop', 'P1', { order: 'a' }); // sequence 0

    // Simulate a service-worker restart: a fresh JobQueue instance, same storage.
    const queueB = new JobQueue(adapter);
    queueB.registerProcessor('noop', noopProcessor);
    const jobC = await queueB.enqueue('noop', 'P1', { order: 'c' }); // must be sequence 1, not reset to 0
    expect(jobC.sequence).toBe(1);

    const first = await queueB.runNext();
    expect((first?.payload as { order: string }).order).toBe('a');
  });

  it('marks jobs complete after a successful run', async () => {
    await queue.enqueue('noop', 'P0', {});
    const result = await queue.runNext();
    expect(result?.status).toBe('COMPLETE');
  });

  it('marks jobs failed and records the error when no processor is registered', async () => {
    await queue.enqueue('unregistered-type', 'P0', {});
    const result = await queue.runNext();
    expect(result?.status).toBe('FAILED');
    expect(result?.lastError).toContain('unregistered-type');
  });

  it('returns undefined when the queue is empty', async () => {
    await expect(queue.runNext()).resolves.toBeUndefined();
  });

  it('reports pending counts by priority', async () => {
    await queue.enqueue('noop', 'P0', {});
    await queue.enqueue('noop', 'P0', {});
    await queue.enqueue('noop', 'P2', {});

    const counts = await queue.countsByPriority();
    expect(counts.P0).toBe(2);
    expect(counts.P1).toBe(0);
    expect(counts.P2).toBe(1);
    expect(counts.P3).toBe(0);
  });

  it('persists queue state across JobQueue instances backed by the same storage', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-shared-${Math.random()}`);
    const queueA = new JobQueue(adapter);
    queueA.registerProcessor('noop', noopProcessor);
    await queueA.enqueue('noop', 'P0', { persisted: true });

    const queueB = new JobQueue(adapter);
    const counts = await queueB.countsByPriority();
    expect(counts.P0).toBe(1);
  });
});

describe('JobQueue stale-RUNNING reclaim', () => {
  it('does not reclaim a RUNNING job that is still within its lease window', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    let clock = '2026-01-01T00:00:00.000Z';
    const queue = new JobQueue(adapter, 1000, () => clock);
    await adapter.put(JOB_STORE, 'stuck-job', stuckRunningJob(), 'CANONICAL');

    clock = '2026-01-01T00:00:00.500Z'; // 500ms elapsed, under the 1000ms timeout
    await expect(queue.next()).resolves.toBeUndefined();
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P0: 0 });
  });

  it('reclaims a RUNNING job whose lease has expired, back to PENDING, and lets it run again', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    let clock = '2026-01-01T00:00:00.000Z';
    const queue = new JobQueue(adapter, 1000, () => clock);
    queue.registerProcessor('noop', noopProcessor);
    await adapter.put(JOB_STORE, 'stuck-job', stuckRunningJob({ attempts: 1 }), 'CANONICAL');

    clock = '2026-01-01T00:00:02.000Z'; // 2s elapsed, past the 1000ms timeout
    const job = await queue.runNext();

    expect(job?.id).toBe('stuck-job');
    expect(job?.status).toBe('COMPLETE');
    expect(job?.attempts).toBe(2); // incremented again on the reclaimed run
    expect(job?.startedAt).toBe(clock);
  });

  it('counts a reclaimed job in countsByPriority once it is back to PENDING', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    let clock = '2026-01-01T00:00:00.000Z';
    const queue = new JobQueue(adapter, 1000, () => clock);
    await adapter.put(JOB_STORE, 'stuck-job', stuckRunningJob(), 'CANONICAL');

    clock = '2026-01-01T00:00:02.000Z';
    await queue.next(); // reclaim runs as a side effect of next()

    await expect(queue.countsByPriority()).resolves.toMatchObject({ P0: 1 });
  });

  it('countsByPriority() reclaims a stale RUNNING job on its own, WITHOUT next() being called first — the deadlock this fixes: background.ts\'s dispatch tick early-returns based solely on countsByPriority()\'s total, so a job invisible to it (RUNNING, not PENDING) could never be reclaimed because next() was never reached', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    let clock = '2026-01-01T00:00:00.000Z';
    const queue = new JobQueue(adapter, 1000, () => clock);
    await adapter.put(JOB_STORE, 'stuck-job', stuckRunningJob(), 'CANONICAL');

    clock = '2026-01-01T00:00:02.000Z'; // past the 1000ms stale timeout
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P0: 1 });
  });
});

describe('JobQueue.enqueueSingleton — rebuild-job coalescing (docs/decisions/0014)', () => {
  it('creates a job on the first call', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    const job = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
    expect(job.status).toBe('PENDING');
  });

  it('returns the existing job instead of creating a duplicate while one is PENDING — repeated clicks stay at one outstanding job', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    const first = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    for (let i = 0; i < 81; i += 1) {
      // Simulates the manual-test scenario: 82 repeated clicks on "Rebuild
      // T2 Profile" must not accumulate 82 pending jobs.
      await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    }
    const second = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    expect(second.id).toBe(first.id);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('treats a RUNNING job as outstanding too, not just PENDING', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('rebuild_t2_profile', () => new Promise(() => {})); // never resolves, stays RUNNING
    const first = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    void queue.runNext(); // moves `first` to RUNNING

    // Give the microtask queue a tick so runNext's status write lands.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    expect(second.id).toBe(first.id);
    const jobs = await adapter.query('jobs');
    expect(jobs).toHaveLength(1);
  });

  it('allows a fresh job once the prior one has COMPLETEd — legitimate rebuilds after completion are not blocked', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('rebuild_t2_profile', noopProcessor);
    const first = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    const completed = await queue.runNext();
    expect(completed?.id).toBe(first.id);
    expect(completed?.status).toBe('COMPLETE');

    const second = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    expect(second.id).not.toBe(first.id);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('allows a fresh job once the prior one has FAILED', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    const first = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {}); // no processor registered -> FAILED
    const failed = await queue.runNext();
    expect(failed?.id).toBe(first.id);
    expect(failed?.status).toBe('FAILED');

    const second = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    expect(second.id).not.toBe(first.id);
  });

  it('does not let different job types interfere with each other', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    const t2 = await queue.enqueueSingleton('rebuild_t2_profile', 'P3', {});
    const vectorIndex = await queue.enqueueSingleton('rebuild_vector_index', 'P3', {});
    expect(t2.id).not.toBe(vectorIndex.id);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 2 });
  });

  it('reclaims a stale RUNNING job before checking "outstanding", instead of treating a dead job as outstanding forever — this is the deadlock a stuck Trial 4 benchmark run hit: every "Run next case" click kept returning the same dead job, and no new one was ever created', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    let clock = '2026-01-01T00:00:00.000Z';
    const queue = new JobQueue(adapter, 1000, () => clock);
    await adapter.put(JOB_STORE, 'stuck-job', stuckRunningJob({ type: 'run_trial4_benchmark_case' }), 'CANONICAL');

    clock = '2026-01-01T00:00:02.000Z'; // past the 1000ms stale timeout
    const retried = await queue.enqueueSingleton('run_trial4_benchmark_case', 'P1', {});

    // The stale job was reclaimed to PENDING and is the one returned — not
    // a second, duplicate job (enqueueSingleton's normal coalescing still
    // applies once the reclaimed job is visible as outstanding-but-PENDING).
    expect(retried.id).toBe('stuck-job');
    expect(retried.status).toBe('PENDING');
    const jobs = await adapter.query('jobs');
    expect(jobs).toHaveLength(1);
  });
});

describe('JobQueue.cancelOutstanding — manual operator unstick', () => {
  it('marks an outstanding RUNNING job FAILED with the given reason, immediately, without waiting for the stale-lease timeout', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    await adapter.put(JOB_STORE, 'stuck-job', stuckRunningJob({ type: 'run_trial4_benchmark_case' }), 'CANONICAL');

    const affected = await queue.cancelOutstanding('run_trial4_benchmark_case', 'Manually reset by operator');
    expect(affected).toBe(1);

    const jobs = await adapter.query<Job>('jobs');
    expect(jobs[0].status).toBe('FAILED');
    expect(jobs[0].lastError).toBe('Manually reset by operator');
    expect(jobs[0].startedAt).toBeUndefined();
  });

  it('marks an outstanding PENDING job FAILED too', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    await queue.enqueue('run_trial4_benchmark_case', 'P1', {});

    const affected = await queue.cancelOutstanding('run_trial4_benchmark_case', 'reset');
    expect(affected).toBe(1);
    const [job] = await queue.listByType('run_trial4_benchmark_case');
    expect(job.status).toBe('FAILED');
  });

  it('unblocks enqueueSingleton immediately after cancelling — a fresh job can be created without waiting for reclaim', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    const first = await adapter.put(
      JOB_STORE,
      'stuck-job',
      stuckRunningJob({ type: 'run_trial4_benchmark_case' }),
      'CANONICAL',
    );
    void first;

    await queue.cancelOutstanding('run_trial4_benchmark_case', 'reset');
    const fresh = await queue.enqueueSingleton('run_trial4_benchmark_case', 'P1', {});

    expect(fresh.id).not.toBe('stuck-job');
    expect(fresh.status).toBe('PENDING');
  });

  it('is a no-op (returns 0) when nothing of that type is outstanding', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    await expect(queue.cancelOutstanding('run_trial4_benchmark_case', 'reset')).resolves.toBe(0);
  });

  it('does not touch a different job type', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    await queue.enqueue('other_type', 'P1', {});

    await queue.cancelOutstanding('run_trial4_benchmark_case', 'reset');

    const [other] = await queue.listByType('other_type');
    expect(other.status).toBe('PENDING');
  });
});

describe('JobQueue priority-gated dispatch', () => {
  it('with no filter, considers every priority (existing behavior)', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('noop', noopProcessor);
    await queue.enqueue('noop', 'P3', {});

    const job = await queue.runNext();
    expect(job?.priority).toBe('P3');
  });

  it('ignores jobs outside the allowed priority set, leaving them PENDING', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('noop', noopProcessor);
    await queue.enqueue('noop', 'P3', {});

    await expect(queue.next(['P0', 'P1'])).resolves.toBeUndefined();
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('runs the highest-priority job within the allowed set, skipping disallowed higher-priority jobs', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('noop', noopProcessor);
    await queue.enqueue('noop', 'P0', { which: 'blocked' });
    const allowedJob = await queue.enqueue('noop', 'P2', { which: 'allowed' });

    // P0 is intentionally excluded here to prove the filter — not realistic
    // usage (every mode allows P0), just isolates the filtering behavior.
    const job = await queue.runNext(['P2']);
    expect(job?.id).toBe(allowedJob.id);

    await expect(queue.countsByPriority()).resolves.toMatchObject({ P0: 1, P2: 0 });
  });
});

describe('JobQueue.listByType — surfacing a job\'s real status/lastError to a UI', () => {
  it('returns only jobs of the requested type, oldest-to-newest by sequence', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('noop', noopProcessor);
    await queue.enqueue('other_type', 'P0', {});
    const first = await queue.enqueue('noop', 'P0', { n: 1 });
    const second = await queue.enqueue('noop', 'P0', { n: 2 });

    const jobs = await queue.listByType('noop');
    expect(jobs.map((j) => j.id)).toEqual([first.id, second.id]);
  });

  it('returns an empty array when no job of that type has ever been enqueued', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    await expect(queue.listByType('never_enqueued')).resolves.toEqual([]);
  });

  it('reflects a FAILED job with its lastError — a processor throwing before doing any work must remain visible, not silently swallowed', async () => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const queue = new JobQueue(adapter);
    queue.registerProcessor('always_throws', async () => {
      throw new Error('not enabled/configured');
    });
    await queue.enqueue('always_throws', 'P1', {});

    await queue.runNext();

    const [job] = await queue.listByType('always_throws');
    expect(job.status).toBe('FAILED');
    expect(job.lastError).toBe('not enabled/configured');
  });
});
