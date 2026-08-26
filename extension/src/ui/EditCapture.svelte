<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{ capture: { sourceText: string; finalText: string } }>();

  let sourceText = '';
  let finalText = '';

  function submit() {
    if (!sourceText.trim() || !finalText.trim()) return;
    dispatch('capture', { sourceText, finalText });
    sourceText = '';
    finalText = '';
  }
</script>

<section>
  <h2>AI output → your edit</h2>
  <textarea bind:value={sourceText} rows="3" placeholder="Paste the AI/machine suggestion..."></textarea>
  <textarea bind:value={finalText} rows="3" placeholder="Paste your edited final version..."></textarea>
  <button on:click={submit}>Capture edit</button>
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
    margin-bottom: 4px;
  }
  button {
    font-size: 12px;
  }
</style>
