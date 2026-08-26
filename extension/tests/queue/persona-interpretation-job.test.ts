import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { JobQueue } from '../../src/queue/job-queue';
import {
  INTERPRET_TRAITS_BELIEFS_JOB,
  createInterpretTraitsBeliefsProcessor,
  enqueuePersonaInterpretation,
} from '../../src/queue/processors/persona-interpretation-job';
import type { PersonaInterpreterService } from '../../src/persona/persona-interpreter-service';

function setup() {
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const queue = new JobQueue(storage);
  const interpret = vi.fn(async () => []);
  const service = { interpret } as unknown as PersonaInterpreterService;
  queue.registerProcessor(INTERPRET_TRAITS_BELIEFS_JOB, createInterpretTraitsBeliefsProcessor(service));
  return { queue, interpret };
}

describe('interpret_traits_beliefs job', () => {
  it('is enqueued as P3', async () => {
    const { queue } = setup();
    await enqueuePersonaInterpretation(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });
  });

  it('invokes service.interpret() when run', async () => {
    const { queue, interpret } = setup();
    await enqueuePersonaInterpretation(queue);

    const job = await queue.runNext();
    expect(job?.status).toBe('COMPLETE');
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated triggers into a single outstanding job, and allows a new one after completion', async () => {
    const { queue } = setup();
    const first = await enqueuePersonaInterpretation(queue);
    for (let i = 0; i < 10; i += 1) await enqueuePersonaInterpretation(queue);
    await expect(queue.countsByPriority()).resolves.toMatchObject({ P3: 1 });

    const completed = await queue.runNext();
    expect(completed?.id).toBe((first as { id: string }).id);
    expect(completed?.status).toBe('COMPLETE');

    const after = await enqueuePersonaInterpretation(queue);
    expect((after as { id: string }).id).not.toBe((first as { id: string }).id);
  });
});
