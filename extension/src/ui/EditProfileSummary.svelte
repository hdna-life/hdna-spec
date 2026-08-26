<script lang="ts">
  import type { EditProfile } from '@spec/schema/edit-profile';

  export let profile: EditProfile | undefined;
</script>

<section>
  <h2>Edit Profile</h2>
  {#if !profile}
    <p>No edits captured yet.</p>
  {:else}
    <ul>
      <li>Edits observed: {profile.sampleCount}</li>
      <li>Mean edit distance: {profile.meanEditDistance.toFixed(1)}</li>
      <li>Mean compression ratio: {profile.meanCompressionRatio.toFixed(2)}</li>
      <li>Mean lexical overlap: {(profile.meanLexicalOverlap * 100).toFixed(0)}%</li>
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
    margin: 0;
    padding: 0;
    font-size: 13px;
  }
  ul {
    list-style: none;
  }
</style>
