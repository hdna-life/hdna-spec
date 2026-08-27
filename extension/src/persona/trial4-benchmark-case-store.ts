import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const CASE_STORE = 'trial4_benchmark_cases';

/**
 * Operator-imported held-out falsification-benchmark cases
 * (docs/decisions/0017). `CACHE` — reproducible from the operator's
 * original held-out file, never canonical persona evidence.
 */
export class Trial4BenchmarkCaseStore {
  constructor(private storage: StorageAdapter) {}

  entryFor(benchmarkCase: Trial4BenchmarkCase): StorageEntry<Trial4BenchmarkCase> {
    return { store: CASE_STORE, key: benchmarkCase.id, value: benchmarkCase, storageClass: 'CACHE' };
  }

  async put(benchmarkCase: Trial4BenchmarkCase): Promise<void> {
    await this.storage.put(CASE_STORE, benchmarkCase.id, benchmarkCase, 'CACHE');
  }

  get(id: string): Promise<Trial4BenchmarkCase | undefined> {
    return this.storage.get<Trial4BenchmarkCase>(CASE_STORE, id);
  }

  list(): Promise<Trial4BenchmarkCase[]> {
    return this.storage.query<Trial4BenchmarkCase>(CASE_STORE);
  }

  async clear(): Promise<void> {
    for (const benchmarkCase of await this.list()) {
      await this.storage.delete(CASE_STORE, benchmarkCase.id);
    }
  }
}
