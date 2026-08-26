import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { WritingSampleStore } from '../../src/persona/sample-store';
import { EditEventStore } from '../../src/persona/edit-event-store';
import { editEventSource, writingSampleSource } from '../../src/persona/embedding-sources';

describe('writingSampleSource', () => {
  it('maps stored writing samples to {id, text} items', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new WritingSampleStore(storage);
    const sample = await store.addSample('hello there');

    const source = writingSampleSource(store);
    expect(source.sourceType).toBe('writing_sample');
    await expect(source.list()).resolves.toEqual([{ id: sample.id, text: 'hello there' }]);
  });
});

describe('editEventSource', () => {
  it('maps stored edit events to {id, text} items using the human-edited final text, not the AI source text', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new EditEventStore(storage);
    const event = await store.add('ai suggestion', 'my edited version');

    const source = editEventSource(store);
    expect(source.sourceType).toBe('edit_event');
    await expect(source.list()).resolves.toEqual([{ id: event.id, text: 'my edited version' }]);
  });
});
