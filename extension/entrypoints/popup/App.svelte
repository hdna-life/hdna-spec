<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
  import { JobQueue } from '../../src/queue/job-queue';
  import { RuntimeControls, type RuntimeControlsState } from '../../src/runtime/controls';
  import type { JobPriority } from '@spec/protocol/job';
  import type { StorageClass } from '@spec/schema/storage-classes';
  import Status from '../../src/ui/Status.svelte';
  import Queue from '../../src/ui/Queue.svelte';
  import StorageUsage from '../../src/ui/StorageUsage.svelte';
  import Controls from '../../src/ui/Controls.svelte';

  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  const controls = new RuntimeControls(storage);

  let counts: Record<JobPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let usage: Record<StorageClass, number> = { CANONICAL: 0, DERIVED: 0, CACHE: 0, RAW: 0 };
  let controlsState: RuntimeControlsState = { processingPaused: false, learningPaused: false };

  async function refresh() {
    counts = await queue.countsByPriority();
    usage = await storage.usageByClass();
    controlsState = await controls.get();
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
