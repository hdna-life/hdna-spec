import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
import type { Trial4TrainingCandidateStore } from './trial4-training-candidate-store';

/**
 * `'append'` preserves the existing corpus (the original, still-default
 * import behavior — duplicate ids are skipped). `'replace'` discards the
 * existing corpus first via the store's already-existing `clear()`, then
 * imports every candidate in the file — no dedup-by-id needed, since the
 * store is empty going in. Added for the "discard the old generated
 * corpus and start review from a clean imported dataset" operator
 * workflow; does not add a new storage abstraction, just sequences the
 * store's two existing methods (`clear()`/`put()`).
 */
export type Trial4ImportMode = 'append' | 'replace';

/**
 * Imports raw (possibly partial — e.g. freshly generated, pre-review)
 * candidate objects into `store`, applying the same review-field defaults
 * `DashboardTrainingReview`'s handler always has (so an imported candidate
 * is immediately valid `Trial4TrainingCandidate` shape regardless of
 * source). Only affects `trial4_training_candidates` — never touches
 * benchmark cases/results, semantic evidence, lore data belonging to
 * other candidates, or any config store.
 */
export async function importTrial4TrainingCandidates(
  store: Trial4TrainingCandidateStore,
  rawCandidates: Trial4TrainingCandidate[],
  mode: Trial4ImportMode,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  if (mode === 'replace') {
    await store.clear();
  }

  const existingIds = mode === 'append' ? new Set((await store.list()).map((c) => c.id)) : new Set<string>();
  const importedAt = now();

  for (const raw of rawCandidates) {
    if (!raw?.id) continue;
    if (mode === 'append' && existingIds.has(raw.id)) continue;
    await store.put({
      ...raw,
      humanVerdict: raw.humanVerdict ?? null,
      includeInTraining: raw.includeInTraining ?? false,
      exclusionReasons: raw.exclusionReasons ?? [],
      operatorNoteTr: raw.operatorNoteTr ?? '',
      loreImportant: raw.loreImportant ?? false,
      loreNoteTr: raw.loreNoteTr ?? null,
      importedAt,
    });
  }
}

/**
 * Discards the entire Trial 4 training-candidate corpus — a thin,
 * directly-testable wrapper around the store's already-existing `clear()`
 * (same "one-line orchestration wrapper" pattern as
 * `enqueueSemanticRevisionJudge`/`enqueueTrial4BenchmarkCase`), so the
 * destructive "Tüm adayları temizle" dashboard action has a single,
 * focused unit to call and test. Affects only `trial4_training_candidates`
 * — no other store is touched.
 */
export async function clearAllTrial4TrainingCandidates(store: Trial4TrainingCandidateStore): Promise<void> {
  await store.clear();
}
