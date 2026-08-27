<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';

  export let candidates: Trial4TrainingCandidate[] = [];

  const dispatch = createEventDispatcher<{
    importCandidates: Trial4TrainingCandidate[];
    decide: { id: string; decision: 'accepted' | 'rejected' };
  }>();

  $: pending = candidates.filter((c) => c.decision === 'pending');
  $: accepted = candidates.filter((c) => c.decision === 'accepted');
  $: rejected = candidates.filter((c) => c.decision === 'rejected');
  $: current = pending[0];

  let fileInput: HTMLInputElement;

  async function handleImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Selected file is not valid JSON.');
      return;
    }
    if (!Array.isArray(parsed)) {
      alert('Expected a JSON array of candidate objects.');
      return;
    }
    dispatch('importCandidates', parsed as Trial4TrainingCandidate[]);
    input.value = '';
  }

  function accept() {
    if (!current) return;
    dispatch('decide', { id: current.id, decision: 'accepted' });
  }

  function reject() {
    if (!current) return;
    dispatch('decide', { id: current.id, decision: 'rejected' });
  }

  function exportAccepted() {
    const blob = new Blob([JSON.stringify(accepted, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial4-accepted-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!current) return;
    if (event.key === 'a' || event.key === 'A') accept();
    else if (event.key === 'r' || event.key === 'R') reject();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<section>
  <h2>Trial 4 — Training Data Review (experimental)</h2>
  <p class="status">
    {candidates.length} imported · {accepted.length} accepted · {rejected.length} rejected · {pending.length} pending
  </p>

  <label class="file-label">
    Import candidates (JSON array from <code>generate_candidates.py</code>)
    <input bind:this={fileInput} type="file" accept="application/json" on:change={handleImportFile} />
  </label>

  {#if current}
    <div class="candidate">
      <p class="field"><strong>Operation:</strong> {current.kind}</p>
      {#if current.beforeContext}<p class="field context">…{current.beforeContext}</p>{/if}
      <p class="field original"><strong>Original:</strong> {current.originalText || '(none)'}</p>
      <p class="field final"><strong>Final:</strong> {current.finalText || '(none)'}</p>
      {#if current.afterContext}<p class="field context">{current.afterContext}…</p>{/if}
      <p class="proposed">
        <strong>Proposed verdict:</strong> {current.proposedVerdict}
        {#if current.proposedDescription}<br />{current.proposedDescription}{/if}
      </p>
      <div class="actions">
        <button class="accept" on:click={accept}>Accept for Training (A)</button>
        <button class="reject" on:click={reject}>Reject (R)</button>
      </div>
    </div>
  {:else}
    <p>No pending candidates. Import a file above, or all imported candidates have been reviewed.</p>
  {/if}

  <button class="export" on:click={exportAccepted} disabled={accepted.length === 0}>
    Export accepted ({accepted.length}) as JSON
  </button>
  <p class="note">
    Only accepted examples become eligible for Trial 4 training —
    rejected/pending candidates are never exported. See
    docs/decisions/0017 for the human-filtered specialization rationale.
  </p>
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
    margin: 4px 0 0;
    padding: 0;
    font-size: 13px;
  }
  .status {
    color: #555;
  }
  .file-label {
    display: block;
    margin-top: 6px;
    font-size: 12px;
  }
  .candidate {
    margin-top: 8px;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  .field {
    font-size: 13px;
  }
  .context {
    color: #999;
    font-style: italic;
  }
  .original {
    color: #a33;
  }
  .final {
    color: #292;
  }
  .proposed {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed #ddd;
  }
  .actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
  }
  button {
    font-size: 12px;
  }
  .accept {
    background: #e6f4ea;
  }
  .reject {
    background: #fbe9e7;
  }
  .export {
    margin-top: 8px;
  }
  .note {
    color: #888;
    font-size: 11px;
  }
</style>
