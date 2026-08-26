<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ScoredEmbedding } from '../persona/vector-index';

  export let embeddingCount: number;
  export let extractorId: string;
  export let extractorVersion: string;
  export let results: ScoredEmbedding[] = [];

  const dispatch = createEventDispatcher<{ rebuild: void; search: string }>();
  let query = '';

  function search() {
    if (!query.trim()) return;
    dispatch('search', query);
  }
</script>

<section>
  <h2>Vector Index</h2>
  <p>{embeddingCount} embeddings ({extractorId} v{extractorVersion})</p>
  <button on:click={() => dispatch('rebuild')}>Rebuild index</button>
  <div class="search">
    <input bind:value={query} placeholder="Search similar..." />
    <button on:click={search}>Search</button>
  </div>
  {#if results.length > 0}
    <ul>
      {#each results as r}
        <li>{r.embedding.sourceType}:{r.embedding.sourceId} ({r.score.toFixed(2)})</li>
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
  p {
    margin: 0 0 4px;
    font-size: 13px;
  }
  .search {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  input {
    flex: 1;
    font-size: 12px;
  }
  button {
    font-size: 12px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    font-size: 12px;
  }
</style>
