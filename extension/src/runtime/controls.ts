import type { StorageAdapter } from '../storage/types';

const CONTROLS_STORE = 'runtime';
const CONTROLS_KEY = 'controls';

export interface RuntimeControlsState {
  /** Jobs remain queued but do not run. Capture continues. */
  processingPaused: boolean;
  /** Capture stops entirely; no new learning evidence is collected. */
  learningPaused: boolean;
}

const DEFAULT_STATE: RuntimeControlsState = {
  processingPaused: false,
  learningPaused: false,
};

/**
 * Persisted pause/resume state, per the design doc's explicit distinction
 * between pausing processing (queue keeps growing, nothing runs) and pausing
 * learning entirely (no new evidence captured).
 */
export class RuntimeControls {
  constructor(private storage: StorageAdapter) {}

  async get(): Promise<RuntimeControlsState> {
    const state = await this.storage.get<RuntimeControlsState>(CONTROLS_STORE, CONTROLS_KEY);
    return state ?? DEFAULT_STATE;
  }

  private async update(patch: Partial<RuntimeControlsState>): Promise<RuntimeControlsState> {
    const current = await this.get();
    const next = { ...current, ...patch };
    await this.storage.put(CONTROLS_STORE, CONTROLS_KEY, next, 'CANONICAL');
    return next;
  }

  pauseProcessing(): Promise<RuntimeControlsState> {
    return this.update({ processingPaused: true });
  }

  resumeProcessing(): Promise<RuntimeControlsState> {
    return this.update({ processingPaused: false });
  }

  pauseLearning(): Promise<RuntimeControlsState> {
    return this.update({ learningPaused: true, processingPaused: true });
  }

  resumeLearning(): Promise<RuntimeControlsState> {
    return this.update({ learningPaused: false });
  }
}
