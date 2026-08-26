import type { StorageClass } from '@spec/schema/storage-classes';

export interface StorageEntry<T = unknown> {
  store: string;
  key: string;
  value: T;
  storageClass: StorageClass;
}

/** Record identity + size, without the value payload — enough to plan and perform eviction. */
export interface StorageRecordMeta {
  store: string;
  key: string;
  storageClass: StorageClass;
  size: number;
}

export interface StorageAdapter {
  get<T>(store: string, key: string): Promise<T | undefined>;
  put<T>(store: string, key: string, value: T, storageClass: StorageClass): Promise<void>;
  /**
   * Writes every entry atomically: either all of them land or none do.
   * Use this instead of sequential `put()` calls whenever two or more writes
   * must be observed together (e.g. a derived receipt plus the aggregate it
   * unlocks) — a crash between separate `put()` calls can otherwise leave
   * state that looks "half applied" to a retried job.
   */
  putMany(entries: StorageEntry[]): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  /** Returns all values in a store, in insertion order. */
  query<T>(store: string): Promise<T[]>;
  /** Total byte estimate per storage class, for the transparency UI. */
  usageByClass(): Promise<Record<StorageClass, number>>;
  /** Metadata (no value payload) for every record, optionally filtered by storage class. Used for eviction planning. */
  listRecordMeta(storageClass?: StorageClass): Promise<StorageRecordMeta[]>;
}
