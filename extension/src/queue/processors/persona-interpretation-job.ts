import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { PersonaInterpreterService } from '../../persona/persona-interpreter-service';

export const INTERPRET_TRAITS_BELIEFS_JOB = 'interpret_traits_beliefs';
export const INTERPRET_TRAITS_BELIEFS_PRIORITY: JobPriority = 'P3';

export function enqueuePersonaInterpretation(queue: JobQueue): Promise<unknown> {
  return queue.enqueueSingleton(INTERPRET_TRAITS_BELIEFS_JOB, INTERPRET_TRAITS_BELIEFS_PRIORITY, {});
}

/** P3: expensive/rare LLM-backed TRAITS/BELIEFS interpretation over current Patterns. */
export function createInterpretTraitsBeliefsProcessor(service: PersonaInterpreterService): JobProcessor<unknown> {
  return async () => {
    await service.interpret();
  };
}
