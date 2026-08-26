import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { EditEventStore } from '../../src/persona/edit-event-store';

describe('EditEventStore', () => {
  it('adds and retrieves an event by id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EditEventStore(storage);

    const event = await store.add('ai output', 'my edited version');
    await expect(store.get(event.id)).resolves.toEqual(event);
  });

  it('returns undefined for an unknown id', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EditEventStore(storage);
    await expect(store.get('missing')).resolves.toBeUndefined();
  });

  it('lists all events', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EditEventStore(storage);
    await store.add('a', 'a2');
    await store.add('b', 'b2');
    const events = await store.list();
    expect(events).toHaveLength(2);
  });

  it('stores events as CANONICAL', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EditEventStore(storage);
    await store.add('a', 'a2');
    const usage = await storage.usageByClass();
    expect(usage.CANONICAL).toBeGreaterThan(0);
  });
});
