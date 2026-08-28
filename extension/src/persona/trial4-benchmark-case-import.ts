import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import { applyTrial4BenchmarkCaseDefaults } from './trial4-benchmark-case-store';
import type { Trial4BenchmarkCaseStore } from './trial4-benchmark-case-store';
import type { Trial4BenchmarkResultStore } from './trial4-benchmark-result-store';

/**
 * Same `'append'`/`'replace'` contract as
 * `trial4-training-candidate-import.ts`'s `Trial4ImportMode` — kept as its
 * own type (rather than importing that one) because the two corpora
 * (training candidates vs. held-out benchmark cases) must never be
 * conflated, even at the type level (docs/decisions/0017's evaluation-
 * integrity separation).
 */
export type Trial4BenchmarkImportMode = 'append' | 'replace';

/**
 * Imports raw (possibly ground-truth-free — see
 * `applyTrial4BenchmarkCaseDefaults`) benchmark case objects into `store`.
 * `'append'` skips any id already present; `'replace'` clears the store
 * first (no dedup needed, since it starts empty). Never touches
 * `Trial4BenchmarkResultStore` — a `'replace'` import of cases alone would
 * leave orphaned results referencing case ids no longer in the store, so
 * callers that want a full reset must call `clearTrial4BenchmarkData`
 * first (the Dashboard's explicit "Clear benchmark data" action already
 * does this ahead of any replace-import, per Operator instruction).
 */
export async function importTrial4BenchmarkCases(
  store: Trial4BenchmarkCaseStore,
  rawCases: Trial4BenchmarkCase[],
  mode: Trial4BenchmarkImportMode,
): Promise<void> {
  if (mode === 'replace') {
    await store.clear();
  }

  const existingIds = mode === 'append' ? new Set((await store.list()).map((c) => c.id)) : new Set<string>();

  for (const raw of rawCases) {
    if (!raw?.id) continue;
    if (mode === 'append' && existingIds.has(raw.id)) continue;
    await store.put(applyTrial4BenchmarkCaseDefaults(raw));
  }
}

/**
 * Discards the entire Trial 4 benchmark corpus — BOTH the imported cases
 * and every result run against them, since a result without its case is
 * meaningless (and a case's stale result would otherwise block
 * `Trial4BenchmarkService.runNextCase` from ever re-selecting it). Only
 * these two stores; never training candidates, semantic evidence, lore
 * data, or any config store. The Dashboard requires operator confirmation
 * before dispatching this — see `Trial4BenchmarkPanel.svelte`.
 */
export async function clearTrial4BenchmarkData(
  caseStore: Trial4BenchmarkCaseStore,
  resultStore: Trial4BenchmarkResultStore,
): Promise<void> {
  await caseStore.clear();
  await resultStore.clear();
}
