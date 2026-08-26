<script lang="ts">
  import type { T2Profile } from '@spec/schema/t2-profile';

  export let profile: T2Profile | undefined;
</script>

<section>
  <h2>Behavioral Estimates (T2)</h2>
  {#if !profile || (!profile.formality && !profile.directness)}
    <p>No evidence classified yet.</p>
  {:else}
    <ul>
      {#if profile.formality}
        <li>
          Formality: {(profile.formality.weightedMeanScore * 100).toFixed(0)}%
          ({profile.formality.sampleCount} samples)
        </li>
      {/if}
      {#if profile.directness}
        <li>
          Directness: {(profile.directness.weightedMeanScore * 100).toFixed(0)}%
          ({profile.directness.sampleCount} samples)
        </li>
      {/if}
    </ul>
    <p class="note">Heuristic estimates, not established traits.</p>
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
    margin: 0;
    padding: 0;
    font-size: 13px;
  }
  ul {
    list-style: none;
  }
  .note {
    color: #888;
    font-size: 11px;
    margin-top: 2px;
  }
</style>
