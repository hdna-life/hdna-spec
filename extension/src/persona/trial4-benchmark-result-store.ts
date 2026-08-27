import type { Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const RESULT_STORE = 'trial4_benchmark_results';

/**
 * Trial 4's blind three-way benchmark results, including human grading
 * (docs/decisions/0017). `DERIVED` — unlike the disposable candidate/case
 * import stores, a judged result is the actual experimental output this
 * trial exists to produce (base vs. trained vs. DeepSeek correctness,
 * blind preference), not reproducible by simply re-fetching an input file.
 */
export class Trial4BenchmarkResultStore {
  constructor(private storage: StorageAdapter) {}

  entryFor(result: Trial4BenchmarkResult): StorageEntry<Trial4BenchmarkResult> {
    return { store: RESULT_STORE, key: result.id, value: result, storageClass: 'DERIVED' };
  }

  async put(result: Trial4BenchmarkResult): Promise<void> {
    await this.storage.put(RESULT_STORE, result.id, result, 'DERIVED');
  }

  get(id: string): Promise<Trial4BenchmarkResult | undefined> {
    return this.storage.get<Trial4BenchmarkResult>(RESULT_STORE, id);
  }

  list(): Promise<Trial4BenchmarkResult[]> {
    return this.storage.query<Trial4BenchmarkResult>(RESULT_STORE);
  }

  async clear(): Promise<void> {
    for (const result of await this.list()) {
      await this.storage.delete(RESULT_STORE, result.id);
    }
  }
}
