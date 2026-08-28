import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type { StorageAdapter, StorageEntry } from '../storage/types';

const CASE_STORE = 'trial4_benchmark_cases';

/**
 * Fills in the ground-truth-lock fields (`humanVerdict`/`humanDimensions`/
 * `groundTruthLocked`) with their "not yet labeled" defaults on a raw
 * imported case object that may be missing them — the benchmark import
 * format deliberately does NOT require ground truth (Test 1 evaluation-
 * stage addendum, docs/decisions/0017): "we want the HUMAN operator to
 * label and lock them in the dashboard before model execution." Mirrors
 * `trial4-training-candidate-import.ts`'s same defaulting discipline for
 * a differently-shaped raw import. Also defensive for any
 * previously-stored case object from before this addendum (e.g. one that
 * still carries the older, removed `expectedVerdict`/`expectedDimensions`
 * fields) — those unrecognized fields are simply dropped, never read as
 * if they were the new ground truth (no silent migration of a value that
 * was never locked under this contract).
 */
export function applyTrial4BenchmarkCaseDefaults(
  raw: Pick<Trial4BenchmarkCase, 'id' | 'kind' | 'originalText' | 'finalText' | 'beforeContext' | 'afterContext'> &
    Partial<Trial4BenchmarkCase>,
): Trial4BenchmarkCase {
  return {
    id: raw.id,
    kind: raw.kind,
    originalText: raw.originalText,
    finalText: raw.finalText,
    beforeContext: raw.beforeContext,
    afterContext: raw.afterContext,
    language: raw.language,
    humanVerdict: raw.groundTruthLocked ? (raw.humanVerdict ?? null) : null,
    humanDimensions: raw.groundTruthLocked ? (raw.humanDimensions ?? []) : [],
    groundTruthLocked: raw.groundTruthLocked ?? false,
    groundTruthLockedAt: raw.groundTruthLocked ? raw.groundTruthLockedAt : undefined,
  };
}

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
