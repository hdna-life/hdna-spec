<script lang="ts">
  import type { RuntimeMode } from '../governor/types';

  export let mode: RuntimeMode = 'DEEP_IDLE';
  export let processingPaused: boolean;
  export let learningPaused: boolean;

  $: statusLabel = learningPaused
    ? 'Learning paused'
    : processingPaused
      ? 'Processing paused'
      : mode;
</script>

<section>
  <h2>Status</h2>
  <p>{statusLabel}</p>
</section>

<style>
  section {
    margin-bottom: 10px;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    color: #666;
    margin: 0 0 4px;
  }
  p {
    margin: 0;
    font-size: 13px;
  }
</style>
