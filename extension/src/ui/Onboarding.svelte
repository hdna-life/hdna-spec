<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let sampleCount: number;

  let text = '';
  const dispatch = createEventDispatcher<{ addSample: string }>();

  function submit() {
    if (!text.trim()) return;
    dispatch('addSample', text);
    text = '';
  }
</script>

<section>
  <h2>Writing samples ({sampleCount})</h2>
  <textarea bind:value={text} rows="4" placeholder="Paste a real writing sample..."></textarea>
  <button on:click={submit}>Add sample</button>
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
  textarea {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-size: 12px;
    resize: vertical;
  }
  button {
    margin-top: 4px;
    font-size: 12px;
  }
</style>
