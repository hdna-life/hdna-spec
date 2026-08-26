<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
  import { JobQueue } from '../../src/queue/job-queue';
  import { RuntimeControls, type RuntimeControlsState } from '../../src/runtime/controls';
  import { RuntimeStatusStore, type RuntimeStatus } from '../../src/runtime/status';
  import { FOREGROUND_PORT_NAME } from '../../src/runtime/foreground-tracker';
  import { WritingSampleStore } from '../../src/persona/sample-store';
  import { ExpressionSheetStore } from '../../src/persona/expression-sheet-store';
  import { EditEventStore } from '../../src/persona/edit-event-store';
  import { EditProfileStore } from '../../src/persona/edit-profile-store';
  import { captureEditEvent } from '../../src/persona/capture';
  import { EmbeddingStore } from '../../src/persona/embedding-store';
  import { HashingEmbeddingProvider } from '../../src/persona/hashing-embedding-provider';
  import { VectorIndexService } from '../../src/persona/vector-index-service';
  import type { ScoredEmbedding } from '../../src/persona/vector-index';
  import {
    enqueueEmbeddingIndex,
    enqueueVectorIndexRebuild,
  } from '../../src/queue/processors/embedding-jobs';
  import type { JobPriority } from '@spec/protocol/job';
  import type { StorageClass } from '@spec/schema/storage-classes';
  import type { ExpressionSheet } from '@spec/schema/expression-sheet';
  import type { EditProfile } from '@spec/schema/edit-profile';
  import Status from '../../src/ui/Status.svelte';
  import Queue from '../../src/ui/Queue.svelte';
  import StorageUsage from '../../src/ui/StorageUsage.svelte';
  import Controls from '../../src/ui/Controls.svelte';
  import Onboarding from '../../src/ui/Onboarding.svelte';
  import ExpressionSheetSummary from '../../src/ui/ExpressionSheetSummary.svelte';
  import EditCapture from '../../src/ui/EditCapture.svelte';
  import EditProfileSummary from '../../src/ui/EditProfileSummary.svelte';
  import VectorIndex from '../../src/ui/VectorIndex.svelte';

  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  const controls = new RuntimeControls(storage);
  const sampleStore = new WritingSampleStore(storage);
  const expressionSheetStore = new ExpressionSheetStore(storage);
  const editEventStore = new EditEventStore(storage);
  const editProfileStore = new EditProfileStore(storage);
  const runtimeStatusStore = new RuntimeStatusStore(storage);
  const embeddingStore = new EmbeddingStore(storage);
  const embeddingProvider = new HashingEmbeddingProvider();
  // Query-time embedding is computed directly here (cheap, pure, read-only);
  // only writes to the index go through the job queue — see docs/decisions/0009.
  const vectorIndex = new VectorIndexService(embeddingProvider, embeddingStore, []);

  let counts: Record<JobPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let usage: Record<StorageClass, number> = { CANONICAL: 0, DERIVED: 0, CACHE: 0, RAW: 0 };
  let controlsState: RuntimeControlsState = { processingPaused: false, learningPaused: false };
  let sampleCount = 0;
  let expressionSheet: ExpressionSheet | undefined;
  let editProfile: EditProfile | undefined;
  let runtimeStatus: RuntimeStatus | undefined;
  let embeddingCount = 0;
  let searchResults: ScoredEmbedding[] = [];

  async function refresh() {
    counts = await queue.countsByPriority();
    usage = await storage.usageByClass();
    controlsState = await controls.get();
    sampleCount = (await sampleStore.list()).length;
    expressionSheet = await expressionSheetStore.get();
    editProfile = await editProfileStore.get();
    runtimeStatus = await runtimeStatusStore.get();
    embeddingCount = (await embeddingStore.list()).length;
  }

  async function addSample(event: CustomEvent<string>) {
    const sample = await sampleStore.addSample(event.detail);
    const samples = await sampleStore.list();
    await expressionSheetStore.recompile(samples);
    await enqueueEmbeddingIndex(queue, 'writing_sample', sample.id, sample.text);
    await refresh();
  }

  async function captureEdit(event: CustomEvent<{ sourceText: string; finalText: string }>) {
    // Persists + enqueues only; actual T0/T1 processing runs deferred in the
    // background dispatch loop, not here — see docs/decisions/0005.
    const captured = await captureEditEvent(queue, editEventStore, event.detail.sourceText, event.detail.finalText);
    await enqueueEmbeddingIndex(queue, 'edit_event', captured.id, captured.finalText);
    await refresh();
  }

  async function rebuildVectorIndex() {
    await enqueueVectorIndexRebuild(queue);
    await refresh();
  }

  async function searchVectors(event: CustomEvent<string>) {
    searchResults = await vectorIndex.query(event.detail, 5);
  }

  async function toggleProcessing() {
    if (controlsState.processingPaused) await controls.resumeProcessing();
    else await controls.pauseProcessing();
    await refresh();
  }

  async function toggleLearning() {
    if (controlsState.learningPaused) await controls.resumeLearning();
    else await controls.pauseLearning();
    await refresh();
  }

  let interval: ReturnType<typeof setInterval>;
  let foregroundPort: chrome.runtime.Port | undefined;
  onMount(() => {
    // Signals the background dispatch loop that a foreground surface is
    // open; disconnects automatically when the popup closes.
    foregroundPort = chrome.runtime.connect({ name: FOREGROUND_PORT_NAME });
    refresh();
    interval = setInterval(refresh, 2000);
  });
  onDestroy(() => {
    clearInterval(interval);
    foregroundPort?.disconnect();
  });
</script>

<main>
  <h1>HDNA</h1>
  <Status
    mode={runtimeStatus?.mode}
    processingPaused={controlsState.processingPaused}
    learningPaused={controlsState.learningPaused}
  />
  <Onboarding {sampleCount} on:addSample={addSample} />
  <ExpressionSheetSummary sheet={expressionSheet} />
  <EditCapture on:capture={captureEdit} />
  <EditProfileSummary profile={editProfile} />
  <VectorIndex
    {embeddingCount}
    extractorId={embeddingProvider.extractorId}
    extractorVersion={embeddingProvider.extractorVersion}
    results={searchResults}
    on:rebuild={rebuildVectorIndex}
    on:search={searchVectors}
  />
  <Queue {counts} />
  <StorageUsage
    {usage}
    lastEvictionAt={runtimeStatus?.lastEvictionAt}
    lastEvictionBytesFreed={runtimeStatus?.lastEvictionBytesFreed}
  />
  <Controls
    processingPaused={controlsState.processingPaused}
    learningPaused={controlsState.learningPaused}
    on:toggleProcessing={toggleProcessing}
    on:toggleLearning={toggleLearning}
  />
</main>

<style>
  main {
    width: 280px;
    padding: 12px;
    font-family: system-ui, sans-serif;
  }
  h1 {
    font-size: 16px;
    margin: 0 0 8px;
  }
</style>
