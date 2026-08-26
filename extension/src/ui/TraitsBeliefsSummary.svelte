<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TraitBeliefClaim } from '@spec/schema/trait-belief';
  import type { PersonaInterpreterConfig } from '../persona/persona-interpreter-config-store';
  import {
    computeFormHydration,
    deriveInterpretationReadiness,
    resolveSavedConfig,
  } from '../persona/persona-interpreter-form-state';

  export let claims: TraitBeliefClaim[] = [];
  export let patternCount = 0;
  export let minPatternCount = 2;
  export let eligible = false;
  export let config: PersonaInterpreterConfig = { enabled: false };

  const dispatch = createEventDispatcher<{
    interpret: void;
    saveConfig: PersonaInterpreterConfig;
  }>();

  let apiKeyInput = '';
  let modelIdInput = '';
  let enabledInput = false;
  // Set once the user touches any field; blocks the parent's 2s refresh
  // poll from clobbering an in-progress edit. Deliberately never reset
  // back to false after Save — every popup open is a fresh component
  // instance (the popup page is torn down on close), so within a single
  // session, once the user starts editing, the form owns its own state
  // rather than re-syncing from a prop that would otherwise briefly lag
  // behind the save it just triggered.
  let dirty = false;

  $: hasApiKey = Boolean(config.apiKey);
  $: readiness = deriveInterpretationReadiness(config, eligible);

  $: {
    const hydration = computeFormHydration(dirty, config);
    if (hydration) {
      apiKeyInput = hydration.apiKeyInput;
      modelIdInput = hydration.modelIdInput;
      enabledInput = hydration.enabledInput;
    }
  }

  function markDirty() {
    dirty = true;
  }

  function save() {
    dispatch('saveConfig', resolveSavedConfig({ apiKeyInput, modelIdInput, enabledInput }, config));
    apiKeyInput = '';
  }
</script>

<section>
  <h2>Traits / Beliefs (T3)</h2>
  {#if readiness === 'not-configured'}
    <p class="status">
      Not configured — save an OpenRouter API key and enable AI interpretation
      below. No network request is made until then.
    </p>
  {:else if readiness === 'below-threshold'}
    <p class="status">
      Below evidence threshold ({patternCount}/{minPatternCount} patterns) —
      no network request is made until enough patterns are compiled.
    </p>
  {:else}
    <p class="status">Ready — interpreting will send {patternCount} pattern(s) to OpenRouter.</p>
  {/if}
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
      OpenRouter API key{#if hasApiKey}<span class="note"> (already saved — leave blank to keep it)</span>{/if}
      <input
        type="password"
        bind:value={apiKeyInput}
        on:input={markDirty}
        placeholder={hasApiKey ? '•••••••• (saved)' : 'sk-or-...'}
      />
    </label>
    <label>
      Model id
      <input type="text" bind:value={modelIdInput} on:input={markDirty} placeholder="openai/gpt-4o-mini" />
    </label>
    <label>
      <input type="checkbox" bind:checked={enabledInput} on:change={markDirty} />
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
  .status {
    color: #555;
  }
</style>
