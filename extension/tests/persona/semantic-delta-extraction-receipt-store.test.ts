import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { SemanticDeltaExtractionReceiptStore } from '../../src/persona/semantic-delta-extraction-receipt-store';
import type { SemanticDeltaExtractionReceipt } from '@spec/schema/semantic-delta-extraction-receipt';

function receipt(overrides: Partial<SemanticDeltaExtractionReceipt> = {}): SemanticDeltaExtractionReceipt {
  return {
    sourceEvidenceId: 'edit_event:e1',
    extractorId: 'openrouter',
    extractorVersion: 'openai/gpt-4o-mini',
    outcome: 'extracted',
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SemanticDeltaExtractionReceiptStore', () => {
  it('round-trips a receipt through put/get, keyed by sourceEvidenceId', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaExtractionReceiptStore(storage);
    const r = receipt();

    await store.put(r);
    await expect(store.get(r.sourceEvidenceId)).resolves.toEqual(r);
  });

  it('lists every stored receipt', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaExtractionReceiptStore(storage);
    await store.put(receipt({ sourceEvidenceId: 'edit_event:e1' }));
    await store.put(receipt({ sourceEvidenceId: 'edit_event:e2' }));

    const all = await store.list();
    expect(all.map((r) => r.sourceEvidenceId).sort()).toEqual(['edit_event:e1', 'edit_event:e2']);
  });

  it('clears every stored receipt', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaExtractionReceiptStore(storage);
    await store.put(receipt());

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores receipts as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaExtractionReceiptStore(storage);
    await store.put(receipt());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });

  it('records an abstained outcome distinctly from extracted', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaExtractionReceiptStore(storage);
    await store.put(receipt({ outcome: 'abstained' }));

    const stored = await store.get('edit_event:e1');
    expect(stored?.outcome).toBe('abstained');
  });

  it('never contains raw evidence text or an API key', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const store = new SemanticDeltaExtractionReceiptStore(storage);
    await store.put(receipt());

    const stored = await store.get('edit_event:e1');
    expect(stored).not.toHaveProperty('sourceText');
    expect(stored).not.toHaveProperty('finalText');
    expect(stored).not.toHaveProperty('apiKey');
  });
});
