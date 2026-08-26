import type { JobPriority } from '@spec/protocol/job';
import type { JobProcessor, JobQueue } from '../job-queue';
import type { PatternCompilerService } from '../../persona/pattern-compiler-service';

export const COMPILE_PATTERNS_JOB = 'compile_patterns';
export const COMPILE_PATTERNS_PRIORITY: JobPriority = 'P3';

export function enqueuePatternCompilation(queue: JobQueue): Promise<unknown> {
  return queue.enqueue(COMPILE_PATTERNS_JOB, COMPILE_PATTERNS_PRIORITY, {});
}

/** P3: expensive/rare full pattern recompilation from all current derived evidence. */
export function createCompilePatternsProcessor(service: PatternCompilerService): JobProcessor<unknown> {
  return async () => {
    await service.compile();
  };
}
