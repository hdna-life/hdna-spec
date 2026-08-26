import type { EditEvent } from '@spec/schema/edit-event';
import type { StorageAdapter } from '../storage/types';

const EDIT_EVENT_STORE = 'edit_events';

/** Canonical AI-suggestion -> human-edit pairs. Never deleted under storage pressure except by explicit user policy. */
export class EditEventStore {
  constructor(private storage: StorageAdapter) {}

  async add(sourceText: string, finalText: string, context?: EditEvent['context']): Promise<EditEvent> {
    const event: EditEvent = {
      id: crypto.randomUUID(),
      sourceText,
      finalText,
      context,
      createdAt: new Date().toISOString(),
    };
    await this.storage.put(EDIT_EVENT_STORE, event.id, event, 'CANONICAL');
    return event;
  }

  get(id: string): Promise<EditEvent | undefined> {
    return this.storage.get<EditEvent>(EDIT_EVENT_STORE, id);
  }

  list(): Promise<EditEvent[]> {
    return this.storage.query<EditEvent>(EDIT_EVENT_STORE);
  }
}
