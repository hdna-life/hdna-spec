import type { StorageClass } from '@spec/schema/storage-classes';
import { STORAGE_CLASS_DELETION_ORDER } from '@spec/schema/storage-classes';
import type { StorageAdapter, StorageEntry, StorageRecordMeta } from './types';

interface Record_ {
  compositeKey: string;
  store: string;
  key: string;
  value: unknown;
  storageClass: StorageClass;
  size: number;
}

const RECORD_STORE = 'records';

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        const os = db.createObjectStore(RECORD_STORE, { keyPath: 'compositeKey' });
        os.createIndex('store', 'store', { unique: false });
        os.createIndex('storageClass', 'storageClass', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function estimateSize(value: unknown): number {
  return JSON.stringify(value).length;
}

/**
 * IndexedDB-backed StorageAdapter. Chosen over SQLite WASM + OPFS for the MVP
 * foundation — see docs/decisions/0001-storage-indexeddb-first.md.
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase>;

  constructor(dbName = 'hdna') {
    this.dbPromise = openDb(dbName);
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, mode);
      const store = tx.objectStore(RECORD_STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get<T>(store: string, key: string): Promise<T | undefined> {
    const record = await this.withStore<Record_ | undefined>('readonly', (s) =>
      s.get(`${store}:${key}`),
    );
    return record?.value as T | undefined;
  }

  async put<T>(store: string, key: string, value: T, storageClass: StorageClass): Promise<void> {
    const record: Record_ = {
      compositeKey: `${store}:${key}`,
      store,
      key,
      value,
      storageClass,
      size: estimateSize(value),
    };
    await this.withStore('readwrite', (s) => s.put(record));
  }

  /**
   * All records share one physical IndexedDB object store, so a single
   * IDBTransaction covering every entry gives genuine all-or-nothing
   * atomicity — IndexedDB commits a transaction only if every request in it
   * succeeds, and aborts (rolling back everything) otherwise.
   */
  async putMany(entries: StorageEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, 'readwrite');
      const store = tx.objectStore(RECORD_STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));

      try {
        for (const entry of entries) {
          const record: Record_ = {
            compositeKey: `${entry.store}:${entry.key}`,
            store: entry.store,
            key: entry.key,
            value: entry.value,
            storageClass: entry.storageClass,
            size: estimateSize(entry.value),
          };
          store.put(record);
        }
      } catch (err) {
        // e.g. a value that fails structured clone — thrown synchronously by
        // put(), not delivered as a request error event. Abort explicitly so
        // any earlier puts already queued in this transaction are rolled
        // back too, preserving all-or-nothing semantics.
        tx.abort();
        reject(err);
      }
    });
  }

  async delete(store: string, key: string): Promise<void> {
    await this.withStore('readwrite', (s) => s.delete(`${store}:${key}`));
  }

  async query<T>(store: string): Promise<T[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, 'readonly');
      const index = tx.objectStore(RECORD_STORE).index('store');
      const req = index.getAll(IDBKeyRange.only(store));
      req.onsuccess = () => resolve((req.result as Record_[]).map((r) => r.value as T));
      req.onerror = () => reject(req.error);
    });
  }

  async usageByClass(): Promise<Record<StorageClass, number>> {
    const db = await this.dbPromise;
    const all = await new Promise<Record_[]>((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, 'readonly');
      const req = tx.objectStore(RECORD_STORE).getAll();
      req.onsuccess = () => resolve(req.result as Record_[]);
      req.onerror = () => reject(req.error);
    });
    const usage = Object.fromEntries(
      STORAGE_CLASS_DELETION_ORDER.map((c) => [c, 0]),
    ) as Record<StorageClass, number>;
    for (const record of all) {
      usage[record.storageClass] += record.size;
    }
    return usage;
  }

  async listRecordMeta(storageClass?: StorageClass): Promise<StorageRecordMeta[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, 'readonly');
      const objectStore = tx.objectStore(RECORD_STORE);
      const req: IDBRequest<Record_[]> = storageClass
        ? objectStore.index('storageClass').getAll(IDBKeyRange.only(storageClass))
        : objectStore.getAll();
      req.onsuccess = () => {
        resolve(req.result.map((r) => ({ store: r.store, key: r.key, storageClass: r.storageClass, size: r.size })));
      };
      req.onerror = () => reject(req.error);
    });
  }
}
