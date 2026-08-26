<script lang="ts">
  import type { JobPriority } from '@spec/protocol/job';

  export let counts: Record<JobPriority, number>;
</script>

<section>
  <h2>Queue</h2>
  <ul>
    {#each Object.entries(counts) as [priority, count]}
      <li>{priority}: {count}</li>
    {/each}
  </ul>
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
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 13px;
  }
</style>
