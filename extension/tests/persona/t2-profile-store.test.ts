import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { T2ProfileStore } from '../../src/persona/t2-profile-store';

describe('T2ProfileStore', () => {
  it('returns undefined before any profile is set', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new T2ProfileStore(storage);
    await expect(store.get()).resolves.toBeUndefined();
  });

  it('round-trips a profile through entryFor + storage.putMany and get', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new T2ProfileStore(storage);
    const profile = {
      formality: { weightedMeanScore: 0.6, totalConfidenceWeight: 2, sampleCount: 2 },
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await storage.putMany([store.entryFor(profile)]);
    await expect(store.get()).resolves.toEqual(profile);
  });

  it('clears the profile', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new T2ProfileStore(storage);
    await storage.putMany([store.entryFor({ updatedAt: '2026-01-01T00:00:00.000Z' })]);

    await store.clear();
    await expect(store.get()).resolves.toBeUndefined();
  });

  it('classifies the profile as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new T2ProfileStore(storage);
    await storage.putMany([store.entryFor({ updatedAt: '2026-01-01T00:00:00.000Z' })]);

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });
});
