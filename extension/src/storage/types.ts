import type { StorageClass } from '@spec/schema/storage-classes';

export interface StorageAdapter {
  get<T>(store: string, key: string): Promise<T | undefined>;
  put<T>(store: string, key: string, value: T, storageClass: StorageClass): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  /** Returns all values in a store, in insertion order. */
  query<T>(store: string): Promise<T[]>;
  /** Total byte estimate per storage class, for the transparency UI. */
  usageByClass(): Promise<Record<StorageClass, number>>;
}
