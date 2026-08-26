<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { SemanticDeltaCandidate } from '@spec/schema/semantic-delta-candidate';
  import type { SemanticDeltaExtractionReceipt } from '@spec/schema/semantic-delta-extraction-receipt';
  import type { SemanticDeltaExtractorConfig } from '../persona/semantic-delta-extractor-config-store';
  import {
    computeFormHydration,
    deriveExtractionReadiness,
    resolveSavedConfig,
  } from '../persona/semantic-delta-extractor-form-state';

  export let candidates: SemanticDeltaCandidate[] = [];
  export let receipts: SemanticDeltaExtractionReceipt[] = [];
  export let config: SemanticDeltaExtractorConfig = { enabled: false };

  const dispatch = createEventDispatcher<{
    extract: void;
    saveConfig: SemanticDeltaExtractorConfig;
  }>();

  let apiKeyInput = '';
  let modelIdInput = '';
  let enabledInput = false;
  // Set once the user touches any field; blocks the parent's 2s refresh
  // poll from clobbering an in-progress edit. Same discipline as
  // TraitsBeliefsSummary.svelte / persona-interpreter-form-state.ts — see
  // docs/decisions/0015's settings-form hydration bug fix. Deliberately
  // never reset back to false after Save.
  let dirty = false;

  $: hasApiKey = Boolean(config.apiKey);
  $: readiness = deriveExtractionReadiness(config);

  $: extractedCount = receipts.filter((r) => r.outcome === 'extracted').length;
  $: abstainedCount = receipts.filter((r) => r.outcome === 'abstained').length;

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
  <h2>Semantic Delta Extraction (Phase 5A — experimental)</h2>
  {#if readiness.kind === 'not-configured'}
    <p class="status">
      Not configured — missing: {readiness.missing.join(', ')}. Save settings
      below to fix this. No network request is made until then.
    </p>
  {:else}
    <p class="status">
      Ready — extraction runs as a low-priority background job and may not
      fire immediately if the popup stays open — see the Queue panel's P3
      count.
    </p>
  {/if}
  <p class="warning">
    Unlike Traits/Beliefs (T3), which only ever sends minimized pattern
    statistics, this experiment sends the <strong>raw original AI draft and
    the raw human final edited text</strong> of each unprocessed edit event
    to the configured OpenRouter model. This only happens when you click the
    button below — nothing is uploaded automatically or in the background.
  </p>
  <button on:click={() => dispatch('extract')}>Extract semantic deltas (Phase 5A)</button>
  <p class="status">
    {receipts.length} source(s) processed: {extractedCount} extracted,
    {abstainedCount} abstained (no meaningful delta).
  </p>
  {#if candidates.length === 0}
    <p>No semantic delta candidates yet.</p>
  {:else}
    <ul>
      {#each candidates as c}
        <li>
          <strong>{c.kind}</strong> — {c.observation}
          {#if c.preferred || c.rejected}
            <br />preferred: {c.preferred ?? '—'}; rejected: {c.rejected ?? '—'}
          {/if}
          <br />context: {c.context}, confidence: {(c.confidence * 100).toFixed(0)}%
          <br />
          <span class="note">
            source: {c.sourceEvidenceId} · {c.extractorId}/{c.extractorVersion} · {c.computedAt}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <details>
    <summary>Semantic delta extraction settings</summary>
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
      Stored in this browser's local extension storage only — not a
      canonical persona record, not encrypted, and deliberately independent
      of the T3 Traits/Beliefs settings above. Enabling this sends raw
      edit-pair text (not just statistics) to the configured model.
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
  li {
    margin-top: 6px;
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
  .warning {
    color: #a35a00;
  }
</style>
