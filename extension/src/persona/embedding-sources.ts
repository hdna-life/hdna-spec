import type { WritingSampleStore } from './sample-store';
import type { EditEventStore } from './edit-event-store';

export interface EmbeddingSourceItem {
  id: string;
  text: string;
}

/** Canonical evidence source, adapted to the shape VectorIndexService needs for a rebuild. */
export interface EmbeddingSource {
  sourceType: string;
  list(): Promise<EmbeddingSourceItem[]>;
}

export function writingSampleSource(store: WritingSampleStore): EmbeddingSource {
  return {
    sourceType: 'writing_sample',
    async list() {
      return (await store.list()).map((s) => ({ id: s.id, text: s.text }));
    },
  };
}

/** Embeds the human-edited final text — the evidence of the user's own expression, not the AI's original suggestion. */
export function editEventSource(store: EditEventStore): EmbeddingSource {
  return {
    sourceType: 'edit_event',
    async list() {
      return (await store.list()).map((e) => ({ id: e.id, text: e.finalText }));
    },
  };
}
