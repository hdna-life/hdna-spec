<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let processingPaused: boolean;
  export let learningPaused: boolean;

  const dispatch = createEventDispatcher<{
    toggleProcessing: void;
    toggleLearning: void;
  }>();
</script>

<section>
  <h2>Controls</h2>
  <label>
    <input
      type="checkbox"
      checked={processingPaused}
      on:change={() => dispatch('toggleProcessing')}
    />
    Pause processing
  </label>
  <label>
    <input
      type="checkbox"
      checked={learningPaused}
      on:change={() => dispatch('toggleLearning')}
    />
    Pause learning completely
  </label>
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
  label {
    display: block;
    font-size: 13px;
  }
</style>
