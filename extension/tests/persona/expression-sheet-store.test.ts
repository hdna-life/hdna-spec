import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { WritingSampleStore } from '../../src/persona/sample-store';
import { ExpressionSheetStore } from '../../src/persona/expression-sheet-store';

describe('ExpressionSheetStore', () => {
  it('returns undefined before any compile has run', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const sheetStore = new ExpressionSheetStore(storage);
    await expect(sheetStore.get()).resolves.toBeUndefined();
  });

  it('recompiles from samples and persists the result', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const sampleStore = new WritingSampleStore(storage);
    const sheetStore = new ExpressionSheetStore(storage);

    await sampleStore.addSample('hello world. how are you?');
    const samples = await sampleStore.list();
    const compiled = await sheetStore.recompile(samples);

    expect(compiled.sentenceLengthTokens?.sampleSize).toBe(2);
    await expect(sheetStore.get()).resolves.toEqual(compiled);
  });

  it('overwrites the previous sheet on a second recompile', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const sampleStore = new WritingSampleStore(storage);
    const sheetStore = new ExpressionSheetStore(storage);

    await sampleStore.addSample('one sentence.');
    await sheetStore.recompile(await sampleStore.list());

    await sampleStore.addSample('another sentence here.');
    const second = await sheetStore.recompile(await sampleStore.list());

    expect(second.sentenceLengthTokens?.sampleSize).toBe(2);
    await expect(sheetStore.get()).resolves.toEqual(second);
  });

  it('stores the expression sheet as DERIVED', async () => {
    const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    const sampleStore = new WritingSampleStore(storage);
    const sheetStore = new ExpressionSheetStore(storage);

    await sampleStore.addSample('hello.');
    await sheetStore.recompile(await sampleStore.list());

    const usage = await storage.usageByClass();
    expect(usage.DERIVED).toBeGreaterThan(0);
  });
});
