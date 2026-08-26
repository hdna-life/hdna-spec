import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import { noopProcessor } from '../../src/queue/processors/noop-processor';

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
