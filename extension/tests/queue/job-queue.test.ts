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
