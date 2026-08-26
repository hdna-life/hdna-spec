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
}

/** Persists the background dispatch loop's live state so the popup (a separate execution context) can display it. */
export class RuntimeStatusStore {
  constructor(private storage: StorageAdapter) {}

  get(): Promise<RuntimeStatus | undefined> {
    return this.storage.get<RuntimeStatus>(RUNTIME_STORE, STATUS_KEY);
  }

  async set(status: RuntimeStatus): Promise<void> {
    await this.storage.put(RUNTIME_STORE, STATUS_KEY, status, 'CACHE');
  }
}
