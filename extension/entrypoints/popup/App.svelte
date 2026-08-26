<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
  import { JobQueue } from '../../src/queue/job-queue';
  import { RuntimeControls, type RuntimeControlsState } from '../../src/runtime/controls';
  import { WritingSampleStore } from '../../src/persona/sample-store';
  import { ExpressionSheetStore } from '../../src/persona/expression-sheet-store';
  import { EditEventStore } from '../../src/persona/edit-event-store';
  import { EditProfileStore } from '../../src/persona/edit-profile-store';
  import { captureEditEvent } from '../../src/persona/capture';
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

  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  const controls = new RuntimeControls(storage);
  const sampleStore = new WritingSampleStore(storage);
  const expressionSheetStore = new ExpressionSheetStore(storage);
  const editEventStore = new EditEventStore(storage);
  const editProfileStore = new EditProfileStore(storage);

  let counts: Record<JobPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let usage: Record<StorageClass, number> = { CANONICAL: 0, DERIVED: 0, CACHE: 0, RAW: 0 };
  let controlsState: RuntimeControlsState = { processingPaused: false, learningPaused: false };
  let sampleCount = 0;
  let expressionSheet: ExpressionSheet | undefined;
  let editProfile: EditProfile | undefined;

  async function refresh() {
    counts = await queue.countsByPriority();
    usage = await storage.usageByClass();
    controlsState = await controls.get();
    sampleCount = (await sampleStore.list()).length;
    expressionSheet = await expressionSheetStore.get();
    editProfile = await editProfileStore.get();
  }

  async function addSample(event: CustomEvent<string>) {
    await sampleStore.addSample(event.detail);
    const samples = await sampleStore.list();
    await expressionSheetStore.recompile(samples);
    await refresh();
  }

  async function captureEdit(event: CustomEvent<{ sourceText: string; finalText: string }>) {
    // Persists + enqueues only; actual T0/T1 processing runs deferred in the
    // background dispatch loop, not here — see docs/decisions/0005.
    await captureEditEvent(queue, editEventStore, event.detail.sourceText, event.detail.finalText);
    await refresh();
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
  onMount(() => {
    refresh();
    interval = setInterval(refresh, 2000);
  });
  onDestroy(() => clearInterval(interval));
</script>

<main>
  <h1>HDNA</h1>
  <Status
    processingPaused={controlsState.processingPaused}
    learningPaused={controlsState.learningPaused}
  />
  <Onboarding {sampleCount} on:addSample={addSample} />
  <ExpressionSheetSummary sheet={expressionSheet} />
  <EditCapture on:capture={captureEdit} />
  <EditProfileSummary profile={editProfile} />
  <Queue {counts} />
  <StorageUsage {usage} />
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
