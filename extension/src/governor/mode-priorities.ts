import type { JobPriority } from '@spec/protocol/job';
import type { RuntimeMode } from './types';

/**
 * Which job priority classes may run in each runtime mode, per the design
 * doc's runtime-modes section: INTERACTIVE runs cheap jobs only (no
 * expensive persona compilation); BACKGROUND additionally allows
 * medium-cost work; DEEP_IDLE allows everything, including the P3-class
 * work (embeddings, persona compilation, derived-artifact rebuilds) that
 * doesn't exist yet but this mapping is already ready for.
 */
export const ALLOWED_PRIORITIES_BY_MODE: Record<RuntimeMode, JobPriority[]> = {
  INTERACTIVE: ['P0', 'P1'],
  BACKGROUND: ['P0', 'P1', 'P2'],
  DEEP_IDLE: ['P0', 'P1', 'P2', 'P3'],
};
