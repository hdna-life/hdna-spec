<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Pattern } from '@spec/schema/pattern';

  export let patterns: Pattern[] = [];

  const dispatch = createEventDispatcher<{ compile: void }>();
</script>

<section>
  <h2>Patterns</h2>
  <button on:click={() => dispatch('compile')}>Compile patterns</button>
  {#if patterns.length === 0}
    <p>No patterns compiled yet (evidence may still be below threshold).</p>
  {:else}
    <ul>
      {#each patterns as p}
        <li>
          {p.dimension} / {p.context}: {(p.value * 100).toFixed(0)}%
          ({p.sampleCount} samples)
        </li>
      {/each}
    </ul>
  {/if}
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
  p,
  ul {
    margin: 4px 0 0;
    padding: 0;
    font-size: 13px;
  }
  ul {
    list-style: none;
  }
  button {
    font-size: 12px;
  }
</style>
