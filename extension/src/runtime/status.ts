import type { RuntimeMode } from '../governor/types';
import type { StorageAdapter } from '../storage/types';

const RUNTIME_STORE = 'runtime';
const STATUS_KEY = 'status';

export interface RuntimeStatus {
  mode: RuntimeMode;
  batchSize: number;
  updatedAt: string;
  lastEvictionAt?: string;
  lastEvictionBytesFreed?: number;
  /**
   * ISO timestamp of when the foreground last transitioned from active to
   * inactive; `undefined` while foreground is currently active. Persisted
   * (not held in service-worker memory) specifically so DEEP_IDLE
   * eligibility — derived from wall-clock elapsed time since this
   * timestamp — survives MV3 service-worker termination between dispatch
   * ticks. See docs/decisions/0014.
   */
  foregroundInactiveSince?: string;
}

/** Persists the background dispatch loop's live state so the popup (a separate execution context) can display it, and so lifecycle-sensitive state survives service-worker restarts. */
export class RuntimeStatusStore {
  constructor(private storage: StorageAdapter) {}

  get(): Promise<RuntimeStatus | undefined> {
    return this.storage.get<RuntimeStatus>(RUNTIME_STORE, STATUS_KEY);
  }

  async set(status: RuntimeStatus): Promise<void> {
    await this.storage.put(RUNTIME_STORE, STATUS_KEY, status, 'CACHE');
  }
}
