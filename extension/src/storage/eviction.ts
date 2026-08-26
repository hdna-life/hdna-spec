import { STORAGE_CLASS_DELETION_ORDER } from '@spec/schema/storage-classes';
import type { StoragePolicy } from '@spec/schema/storage-policy';
import type { StorageAdapter, StorageRecordMeta } from './types';

export interface EvictionPlan {
  toDelete: StorageRecordMeta[];
  bytesFreed: number;
  remainingBytes: number;
}

/**
 * Deterministic eviction planner: evicts whole storage classes in
 * CACHE -> DERIVED -> RAW priority order (per the design doc's storage
 * policy) until back under budget. CANONICAL is never evicted automatically
 * — "canonical evidence only by explicit user policy."
 *
 * Within a class, order is whatever the caller's record listing returns
 * (not LRU/recency-based) — a documented simplification for this first
 * pass; finer-grained eviction ordering is future work if it's ever needed.
 */
export function planEviction(
  allRecords: StorageRecordMeta[],
  currentTotalBytes: number,
  policy: StoragePolicy,
): EvictionPlan {
  if (currentTotalBytes <= policy.maxTotalBytes) {
    return { toDelete: [], bytesFreed: 0, remainingBytes: currentTotalBytes };
  }

  const evictableOrder = STORAGE_CLASS_DELETION_ORDER.filter((c) => c !== 'CANONICAL');
  const toDelete: StorageRecordMeta[] = [];
  let remaining = currentTotalBytes;

  for (const storageClass of evictableOrder) {
    if (remaining <= policy.maxTotalBytes) break;
    for (const record of allRecords.filter((r) => r.storageClass === storageClass)) {
      if (remaining <= policy.maxTotalBytes) break;
      toDelete.push(record);
      remaining -= record.size;
    }
  }

  return { toDelete, bytesFreed: currentTotalBytes - remaining, remainingBytes: remaining };
}

/** Checks current usage against the policy and deletes records per planEviction() if over budget. No-op when under budget. */
export async function evictIfNeeded(storage: StorageAdapter, policy: StoragePolicy): Promise<EvictionPlan> {
  const usage = await storage.usageByClass();
  const total = Object.values(usage).reduce((a, b) => a + b, 0);
  if (total <= policy.maxTotalBytes) {
    return { toDelete: [], bytesFreed: 0, remainingBytes: total };
  }

  const allRecords = await storage.listRecordMeta();
  const plan = planEviction(allRecords, total, policy);
  for (const record of plan.toDelete) {
    await storage.delete(record.store, record.key);
  }
  return plan;
}
