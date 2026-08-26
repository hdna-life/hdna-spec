/**
 * Storage budget enforced by eviction. A single total-byte budget for the
 * MVP; per-class budgets and user-configurable limits (per the design doc's
 * "configure storage limits" user control) remain a future UI addition.
 */
export interface StoragePolicy {
  maxTotalBytes: number;
}

/** Placeholder default — real UI-configurable limits are future work. */
export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  maxTotalBytes: 50 * 1024 * 1024,
};
