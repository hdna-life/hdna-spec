<script lang="ts">
  import type { StorageClass } from '@spec/schema/storage-classes';

  export let usage: Record<StorageClass, number>;
  export let lastEvictionAt: string | undefined = undefined;
  export let lastEvictionBytesFreed: number | undefined = undefined;

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
</script>

<section>
  <h2>Storage</h2>
  <ul>
    {#each Object.entries(usage) as [storageClass, bytes]}
      <li>{storageClass}: {formatBytes(bytes)}</li>
    {/each}
    {#if lastEvictionAt && lastEvictionBytesFreed !== undefined}
      <li>Last eviction: freed {formatBytes(lastEvictionBytesFreed)}</li>
    {/if}
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
