<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
  import type {
    Trial4BenchmarkLabel,
    Trial4BenchmarkResult,
    Trial4ResponseGrade,
  } from '@spec/schema/trial4-benchmark-result';
  import type { Trial4BenchmarkConfig } from '../persona/trial4-benchmark-config-store';
  import { computeTrial4BenchmarkStats } from '../persona/trial4-benchmark-stats';

  export let cases: Trial4BenchmarkCase[] = [];
  export let results: Trial4BenchmarkResult[] = [];
  export let config: Trial4BenchmarkConfig = { enabled: false };

  const dispatch = createEventDispatcher<{
    importCases: Trial4BenchmarkCase[];
    runNextCase: void;
    submitJudgment: {
      resultId: string;
      grades: Record<Trial4BenchmarkLabel, Trial4ResponseGrade>;
      bestResponse: Trial4BenchmarkResult['bestResponse'];
      note: string;
    };
    reveal: string;
    saveConfig: Trial4BenchmarkConfig;
  }>();

  const LABELS: Trial4BenchmarkLabel[] = ['A', 'B', 'C'];

  $: stats = computeTrial4BenchmarkStats(results);
  $: unjudged = results.find((r) => !r.judged);
  $: remainingCases = cases.length - results.length;

  // --- settings form (same hydration-safety discipline as every other
  // experimental settings block in this codebase — see
  // semantic-revision-judge-form-state.ts's docstring). ---
  let baseModelUrlInput = '';
  let trainedModelUrlInput = '';
  let localModelIdInput = '';
  let deepSeekApiKeyInput = '';
  let deepSeekModelIdInput = '';
  let enabledInput = false;
  let dirty = false;

  $: hasDeepSeekApiKey = Boolean(config.deepSeekApiKey);

  $: {
    if (!dirty) {
      baseModelUrlInput = config.baseModelUrl ?? '';
      trainedModelUrlInput = config.trainedModelUrl ?? '';
      localModelIdInput = config.localModelId ?? '';
      deepSeekApiKeyInput = '';
      deepSeekModelIdInput = config.deepSeekModelId ?? '';
      enabledInput = config.enabled;
    }
  }

  function markDirty() {
    dirty = true;
  }

  function saveConfig() {
    dispatch('saveConfig', {
      enabled: enabledInput,
      baseModelUrl: baseModelUrlInput.trim() || undefined,
      trainedModelUrl: trainedModelUrlInput.trim() || undefined,
      localModelId: localModelIdInput.trim() || undefined,
      deepSeekApiKey: deepSeekApiKeyInput.trim() || config.deepSeekApiKey,
      deepSeekModelId: deepSeekModelIdInput.trim() || undefined,
    });
    deepSeekApiKeyInput = '';
  }

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
      alert('Expected a JSON array of benchmark case objects.');
      return;
    }
    dispatch('importCases', parsed as Trial4BenchmarkCase[]);
    input.value = '';
  }

  // --- judging form for the current unjudged result ---
  let grades: Record<Trial4BenchmarkLabel, Trial4ResponseGrade | ''> = { A: '', B: '', C: '' };
  let bestResponse: Trial4BenchmarkResult['bestResponse'] = null;
  let note = '';

  $: {
    // Reset the judging form whenever a different result becomes current.
    void unjudged?.id;
    grades = { A: '', B: '', C: '' };
    bestResponse = null;
    note = '';
  }

  function canSubmit(): boolean {
    return LABELS.every((label) => grades[label] !== '') && bestResponse !== null;
  }

  function submit() {
    if (!unjudged || !canSubmit()) return;
    dispatch('submitJudgment', {
      resultId: unjudged.id,
      grades: grades as Record<Trial4BenchmarkLabel, Trial4ResponseGrade>,
      bestResponse,
      note,
    });
  }

  function revealResult(resultId: string) {
    dispatch('reveal', resultId);
  }

  function roleLabel(role: string): string {
    if (role === 'base') return 'Base Qwen3-0.6B (untrained)';
    if (role === 'trained') return 'Trained Qwen3-0.6B (LoRA)';
    return 'DeepSeek (frontier reference)';
  }
</script>

<section>
  <h2>Trial 4 — Blind Benchmark (experimental)</h2>
  <p class="status">
    {cases.length} case(s) imported · {results.length} run · {Math.max(remainingCases, 0)} remaining ·
    {stats.judgedResultCount} judged
  </p>

  <label class="file-label">
    Import held-out benchmark cases (JSON array — operator-supplied real
    held-out corpus, never generator output)
    <input type="file" accept="application/json" on:change={handleImportFile} />
  </label>

  <button on:click={() => dispatch('runNextCase')} disabled={remainingCases <= 0}>
    Run next case ({Math.max(remainingCases, 0)} remaining)
  </button>

  {#if unjudged}
    <div class="result">
      <p class="note">Case: {unjudged.caseId} — grade each response, then submit.</p>
      {#each LABELS as label}
        {@const responseItem = unjudged.labelMapping[label]}
        <div class="response">
          <p class="label">
            <strong>{label}</strong>
            {#if unjudged.revealed}<span class="role">({roleLabel(responseItem.role)})</span>{/if}
          </p>
          {#if responseItem.error}
            <p class="error">Provider error: {responseItem.error}</p>
          {:else}
            <p><strong>verdict:</strong> {responseItem.verdict}</p>
            {#if responseItem.description}<p>{responseItem.description}</p>{/if}
            <p class="note">confidence: {responseItem.confidence !== null ? (responseItem.confidence * 100).toFixed(0) + '%' : '—'}</p>
          {/if}
          <div class="grade-buttons">
            <label><input type="radio" name={`grade-${label}`} value="correct" bind:group={grades[label]} /> Correct</label>
            <label><input type="radio" name={`grade-${label}`} value="partial" bind:group={grades[label]} /> Partial</label>
            <label><input type="radio" name={`grade-${label}`} value="wrong" bind:group={grades[label]} /> Wrong</label>
          </div>
        </div>
      {/each}

      <p class="note"><strong>Best response:</strong></p>
      <div class="grade-buttons">
        {#each LABELS as label}
          <label><input type="radio" name="best" value={label} bind:group={bestResponse} /> {label}</label>
        {/each}
        <label><input type="radio" name="best" value="tie" bind:group={bestResponse} /> Tie</label>
      </div>

      <label class="note-field">
        Note (optional)
        <input type="text" bind:value={note} />
      </label>

      <div class="actions">
        <button on:click={submit} disabled={!canSubmit()}>Submit judgment</button>
        {#if !unjudged.revealed}
          <button on:click={() => revealResult(unjudged.id)}>Reveal models</button>
        {/if}
      </div>
    </div>
  {:else}
    <p>No in-progress case. Click "Run next case" to benchmark the next held-out case.</p>
  {/if}

  <h3>Aggregate results</h3>
  <ul class="stats">
    <li>Base Qwen: {(stats.base.correctRate * 100).toFixed(0)}% correct ({stats.base.judgedCount} judged, {stats.base.errors} errors)</li>
    <li>Trained Qwen: {(stats.trained.correctRate * 100).toFixed(0)}% correct ({stats.trained.judgedCount} judged, {stats.trained.errors} errors)</li>
    <li>DeepSeek: {(stats.deepseek.correctRate * 100).toFixed(0)}% correct ({stats.deepseek.judgedCount} judged, {stats.deepseek.errors} errors)</li>
    <li>Trained vs. base improvement: {(stats.trainedVsBaseImprovement * 100).toFixed(1)} points</li>
    <li>
      Blind wins — base: {stats.winCounts.base}, trained: {stats.winCounts.trained}, DeepSeek:
      {stats.winCounts.deepseek}, tie: {stats.tieCount}
    </li>
  </ul>

  <details>
    <summary>Trial 4 benchmark settings</summary>
    <label>
      Base (untrained) Qwen server URL
      <input type="text" bind:value={baseModelUrlInput} on:input={markDirty} placeholder="http://127.0.0.1:8080" />
    </label>
    <label>
      Trained Qwen server URL
      <input type="text" bind:value={trainedModelUrlInput} on:input={markDirty} placeholder="http://127.0.0.1:8081" />
    </label>
    <label>
      Local model id (sent to both local servers)
      <input type="text" bind:value={localModelIdInput} on:input={markDirty} placeholder="Qwen/Qwen3-0.6B" />
    </label>
    <label>
      DeepSeek API key{#if hasDeepSeekApiKey}<span class="note"> (already saved — leave blank to keep it)</span>{/if}
      <input
        type="password"
        bind:value={deepSeekApiKeyInput}
        on:input={markDirty}
        placeholder={hasDeepSeekApiKey ? '•••••••• (saved)' : 'sk-...'}
      />
    </label>
    <label>
      DeepSeek model id
      <input type="text" bind:value={deepSeekModelIdInput} on:input={markDirty} placeholder="deepseek-v4-flash" />
    </label>
    <label>
      <input type="checkbox" bind:checked={enabledInput} on:change={markDirty} />
      Enabled
    </label>
    <button on:click={saveConfig}>Save</button>
    <p class="note">
      DeepSeek is a frontier reference only — it does not decide whether
      the trained model is correct. Model identities stay hidden until you
      click "Reveal models," and revealing never changes a recorded
      judgment. See docs/decisions/0017.
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
  h3 {
    font-size: 11px;
    text-transform: uppercase;
    color: #777;
    margin: 10px 0 2px;
  }
  p,
  ul {
    margin: 4px 0 0;
    padding: 0;
    font-size: 13px;
  }
  ul.stats {
    list-style: none;
  }
  .status {
    color: #555;
  }
  .file-label {
    display: block;
    margin-top: 6px;
    font-size: 12px;
  }
  .result {
    margin-top: 8px;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  .response {
    margin-top: 6px;
    padding: 6px;
    background: #fafafa;
    border-radius: 4px;
  }
  .label {
    font-size: 13px;
  }
  .role {
    color: #888;
    font-weight: normal;
  }
  .error {
    color: #b00;
  }
  .grade-buttons {
    display: flex;
    gap: 10px;
    font-size: 12px;
    margin-top: 4px;
  }
  .note-field {
    display: block;
    margin-top: 6px;
    font-size: 12px;
  }
  .note-field input {
    width: 100%;
    box-sizing: border-box;
  }
  .actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
  }
  button {
    font-size: 12px;
    margin-top: 6px;
  }
  details {
    margin-top: 8px;
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
