<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { T2Profile } from '@spec/schema/t2-profile';
  import { deriveT2PanelState } from '../persona/t2-panel-state';

  export let profile: T2Profile | undefined;
  export let evidenceCount = 0;
  export let classifiedCount = 0;

  const dispatch = createEventDispatcher<{ rebuild: void }>();

  $: panelState = deriveT2PanelState({ evidenceCount, classifiedCount, profile });
</script>

<section>
  <h2>Behavioral Estimates (T2)</h2>
  <button on:click={() => dispatch('rebuild')}>Rebuild T2 Profile</button>
  {#if panelState.kind === 'no-evidence'}
    <p>No evidence available yet.</p>
  {:else if panelState.kind === 'abstained'}
    <p>No supported evidence classified yet.</p>
    <p class="note">
      The current heuristic baseline only classifies supported English evidence; other evidence is
      preserved but skipped.
    </p>
    <p class="note">
      {panelState.evidenceCount} evidence items preserved; {panelState.classifiedCount} classified by
      the current T2 heuristic.
    </p>
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
  button {
    font-size: 12px;
    margin-bottom: 4px;
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
