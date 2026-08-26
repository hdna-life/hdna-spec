import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { RuntimeControls } from '../../src/runtime/controls';

describe('RuntimeControls', () => {
  let controls: RuntimeControls;

  beforeEach(() => {
    const adapter = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
    controls = new RuntimeControls(adapter);
  });

  it('defaults to unpaused', async () => {
    await expect(controls.get()).resolves.toEqual({
      processingPaused: false,
      learningPaused: false,
    });
  });

  it('pauses and resumes processing independently of learning', async () => {
    await controls.pauseProcessing();
    await expect(controls.get()).resolves.toEqual({
      processingPaused: true,
      learningPaused: false,
    });

    await controls.resumeProcessing();
    await expect(controls.get()).resolves.toEqual({
      processingPaused: false,
      learningPaused: false,
    });
  });

  it('pausing learning also pauses processing (capture stops implies nothing to process)', async () => {
    await controls.pauseLearning();
    await expect(controls.get()).resolves.toEqual({
      processingPaused: true,
      learningPaused: true,
    });
  });

  it('resuming learning does not by itself resume processing', async () => {
    await controls.pauseLearning();
    await controls.resumeLearning();
    await expect(controls.get()).resolves.toEqual({
      processingPaused: true,
      learningPaused: false,
    });
  });
});
