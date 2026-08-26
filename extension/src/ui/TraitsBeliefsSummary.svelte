<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TraitBeliefClaim } from '@spec/schema/trait-belief';
  import type { PersonaInterpreterConfig } from '../persona/persona-interpreter-config-store';

  export let claims: TraitBeliefClaim[] = [];
  export let patternCount = 0;
  export let config: PersonaInterpreterConfig = { enabled: false };

  const dispatch = createEventDispatcher<{
    interpret: void;
    saveConfig: PersonaInterpreterConfig;
  }>();

  let apiKeyInput = '';
  let modelIdInput = '';
  let enabledInput = false;
  let initialized = false;

  $: if (!initialized) {
    apiKeyInput = config.apiKey ?? '';
    modelIdInput = config.modelId ?? 'openai/gpt-4o-mini';
    enabledInput = config.enabled;
    initialized = true;
  }

  function save() {
    dispatch('saveConfig', { enabled: enabledInput, apiKey: apiKeyInput, modelId: modelIdInput });
  }
</script>

<section>
  <h2>Traits / Beliefs (T3)</h2>
  <button on:click={() => dispatch('interpret')}>Interpret traits/beliefs</button>
  {#if claims.length === 0}
    <p>No traits/beliefs interpreted yet (patterns may still be below threshold).</p>
  {:else}
    <ul>
      {#each claims as c}
        <li>
          {c.claim} ({c.context}) — {(c.confidence * 100).toFixed(0)}% confidence,
          {c.supportingPatternKeys.length} supporting pattern(s)
        </li>
      {/each}
    </ul>
  {/if}

  <details>
    <summary>AI interpretation settings</summary>
    <label>
      OpenRouter API key
      <input type="password" bind:value={apiKeyInput} placeholder="sk-or-..." />
    </label>
    <label>
      Model id
      <input type="text" bind:value={modelIdInput} placeholder="openai/gpt-4o-mini" />
    </label>
    <label>
      <input type="checkbox" bind:checked={enabledInput} />
      Enabled
    </label>
    <button on:click={save}>Save</button>
    <p class="note">
      Stored in this browser's local extension storage only — not a canonical
      persona record, not encrypted. Only aggregated pattern statistics
      ({patternCount} pattern(s) currently) are sent to OpenRouter; raw
      writing samples and edit events are never sent.
    </p>
  </details>
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
  details {
    margin-top: 6px;
    font-size: 12px;
  }
  label {
    display: block;
    margin-top: 4px;
  }
  input[type='password'],
  input[type='text'] {
    width: 100%;
    box-sizing: border-box;
  }
  .note {
    color: #888;
    font-size: 11px;
  }
</style>
