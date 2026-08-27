<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
  import type { Trial4BenchmarkLabel, Trial4BenchmarkRank, Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';
  import type { Trial4BenchmarkConfig } from '../persona/trial4-benchmark-config-store';
  import { computeTrial4BenchmarkStats } from '../persona/trial4-benchmark-stats';

  export let cases: Trial4BenchmarkCase[] = [];
  export let results: Trial4BenchmarkResult[] = [];
  export let config: Trial4BenchmarkConfig = { enabled: false };

  interface AcceptabilityEntry {
    acceptable: boolean | null;
    rank: Trial4BenchmarkRank | null;
  }

  const dispatch = createEventDispatcher<{
    importCases: Trial4BenchmarkCase[];
    runNextCase: void;
    submitJudgment: {
      resultId: string;
      acceptability: Record<Trial4BenchmarkLabel, { acceptable: boolean; rank: Trial4BenchmarkRank | null }>;
      note: string;
    };
    reveal: string;
    saveConfig: Trial4BenchmarkConfig;
  }>();

  const LABELS: Trial4BenchmarkLabel[] = ['A', 'B', 'C'];

  // Test 1's central question is not "does trained Qwen beat DeepSeek" — it
  // is base->trained improvement and acceptable-local-judge quality under
  // the v3 contract (docs/decisions/0017's "acceptability gate + ranking"
  // addendum). `cases` is passed through for frozen expectedVerdict/
  // expectedDimensions ground-truth accuracy, when present.
  $: stats = computeTrial4BenchmarkStats(results, cases);
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

  // --- judging form for the current unjudged result: acceptability gate +
  // ranking (docs/decisions/0017's "acceptability gate + ranking"
  // addendum, superseding the earlier Correct/Partial/Wrong + free-choice
  // "Best response A/B/C/Tie" model). An unacceptable response can never
  // carry a rank; acceptable responses must be ranked as a dense 1..N
  // permutation with no duplicates — this mirrors
  // Trial4BenchmarkService.submitJudgment's own validation, checked here
  // too so the operator gets immediate feedback instead of a thrown error. ---
  let acceptability: Record<Trial4BenchmarkLabel, AcceptabilityEntry> = {
    A: { acceptable: null, rank: null },
    B: { acceptable: null, rank: null },
    C: { acceptable: null, rank: null },
  };
  let note = '';

  $: {
    // Reset the judging form whenever a different result becomes current.
    void unjudged?.id;
    acceptability = {
      A: { acceptable: null, rank: null },
      B: { acceptable: null, rank: null },
      C: { acceptable: null, rank: null },
    };
    note = '';
  }

  function setAcceptable(label: Trial4BenchmarkLabel, value: boolean) {
    acceptability[label] = { acceptable: value, rank: value ? acceptability[label].rank : null };
    acceptability = acceptability;
  }

  function setRank(label: Trial4BenchmarkLabel, rank: Trial4BenchmarkRank) {
    acceptability[label] = { ...acceptability[label], rank };
    acceptability = acceptability;
  }

  $: acceptableLabels = LABELS.filter((label) => acceptability[label].acceptable === true);

  function canSubmit(): boolean {
    if (LABELS.some((label) => acceptability[label].acceptable === null)) return false;
    const ranks = acceptableLabels.map((label) => acceptability[label].rank);
    if (ranks.some((rank) => rank === null)) return false;
    const expected = acceptableLabels.map((_label, index) => index + 1);
    return JSON.stringify([...ranks].sort()) === JSON.stringify(expected);
  }

  function submit() {
    if (!unjudged || !canSubmit()) return;
    const payload: Record<Trial4BenchmarkLabel, { acceptable: boolean; rank: Trial4BenchmarkRank | null }> = {
      A: { acceptable: acceptability.A.acceptable === true, rank: acceptability.A.rank },
      B: { acceptable: acceptability.B.acceptable === true, rank: acceptability.B.rank },
      C: { acceptable: acceptability.C.acceptable === true, rank: acceptability.C.rank },
    };
    dispatch('submitJudgment', { resultId: unjudged.id, acceptability: payload, note });
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
      <p class="note">
        Case: {unjudged.caseId} — mark each response acceptable or unacceptable, then rank the
        acceptable ones (1 = best). An unacceptable response gets no rank. If none are acceptable,
        submit with all three marked unacceptable — that is itself a valid, meaningful result.
      </p>
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
            {#if responseItem.dimensions.length > 0}
              <p class="dimensions">
                dimensions:
                {#each responseItem.dimensions as change, i}{i > 0 ? ', ' : ' '}{change.dimension}:{change.direction}{/each}
              </p>
            {/if}
            {#if responseItem.description}<p>{responseItem.description}</p>{/if}
            <p class="note">confidence: {responseItem.confidence !== null ? (responseItem.confidence * 100).toFixed(0) + '%' : '—'}</p>
          {/if}
          <div class="grade-buttons">
            <label>
              <input
                type="radio"
                name={`acceptable-${label}`}
                checked={acceptability[label].acceptable === true}
                on:change={() => setAcceptable(label, true)}
              /> Acceptable
            </label>
            <label>
              <input
                type="radio"
                name={`acceptable-${label}`}
                checked={acceptability[label].acceptable === false}
                on:change={() => setAcceptable(label, false)}
              /> Unacceptable
            </label>
          </div>
          {#if acceptability[label].acceptable === true}
            <div class="grade-buttons">
              {#each [1, 2, 3] as rank}
                <label>
                  <input
                    type="radio"
                    name={`rank-${label}`}
                    checked={acceptability[label].rank === rank}
                    on:change={() => setRank(label, rank as Trial4BenchmarkRank)}
                  /> Rank {rank}
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

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
  <p class="note">
    DeepSeek is a frontier reference/ceiling, not a success condition — trained Qwen does not need
    to beat it. The central result is trained-vs-base improvement and whether trained Qwen reaches
    an acceptable local-judge quality level.
  </p>
  <ul class="stats">
    <li>
      Base Qwen: {(stats.base.acceptableRate * 100).toFixed(0)}% acceptable ({stats.base.acceptableCount}/{stats.base
        .acceptabilityJudgedCount}), rank-1 {(stats.base.rank1Rate * 100).toFixed(0)}%, mean rank
      {stats.base.meanRankAmongAcceptable !== null ? stats.base.meanRankAmongAcceptable.toFixed(2) : '—'}
      ({stats.base.errors} errors)
    </li>
    <li>
      Trained Qwen: {(stats.trained.acceptableRate * 100).toFixed(0)}% acceptable ({stats.trained
        .acceptableCount}/{stats.trained.acceptabilityJudgedCount}), rank-1
      {(stats.trained.rank1Rate * 100).toFixed(0)}%, mean rank
      {stats.trained.meanRankAmongAcceptable !== null ? stats.trained.meanRankAmongAcceptable.toFixed(2) : '—'}
      ({stats.trained.errors} errors)
    </li>
    <li>
      DeepSeek: {(stats.deepseek.acceptableRate * 100).toFixed(0)}% acceptable ({stats.deepseek
        .acceptableCount}/{stats.deepseek.acceptabilityJudgedCount}), rank-1
      {(stats.deepseek.rank1Rate * 100).toFixed(0)}%, mean rank
      {stats.deepseek.meanRankAmongAcceptable !== null ? stats.deepseek.meanRankAmongAcceptable.toFixed(2) : '—'}
      ({stats.deepseek.errors} errors)
    </li>
    <li><strong>Trained vs. base improvement (acceptability rate): {(stats.trainedVsBaseImprovement * 100).toFixed(1)} points</strong></li>
    <li>
      Blind rank-1 wins — base: {stats.winCounts.base}, trained: {stats.winCounts.trained}, DeepSeek:
      {stats.winCounts.deepseek}; no acceptable response: {stats.noAcceptableResponseCount}
    </li>
    {#if stats.base.verdictAccuracyCount > 0}
      <li>
        Verdict accuracy vs. frozen ground truth — base: {((stats.base.verdictAccuracy ?? 0) * 100).toFixed(0)}%,
        trained: {((stats.trained.verdictAccuracy ?? 0) * 100).toFixed(0)}%, DeepSeek:
        {((stats.deepseek.verdictAccuracy ?? 0) * 100).toFixed(0)}% ({stats.base.verdictAccuracyCount} cases)
      </li>
    {/if}
    {#if stats.base.dimensionGroundTruthCount > 0}
      <li>
        Dimension exact-set accuracy / micro-F1 vs. frozen ground truth — base:
        {((stats.base.dimensionExactSetAccuracy ?? 0) * 100).toFixed(0)}% / {(stats.base.dimensionMicroF1 ?? 0).toFixed(2)},
        trained: {((stats.trained.dimensionExactSetAccuracy ?? 0) * 100).toFixed(0)}% /
        {(stats.trained.dimensionMicroF1 ?? 0).toFixed(2)}, DeepSeek:
        {((stats.deepseek.dimensionExactSetAccuracy ?? 0) * 100).toFixed(0)}% /
        {(stats.deepseek.dimensionMicroF1 ?? 0).toFixed(2)} ({stats.base.dimensionGroundTruthCount} cases)
      </li>
    {/if}
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
  /*
   * This component previously rendered inside the extension popup
   * (small, fixed-width) — it now renders only inside the full-page
   * Dashboard (docs/decisions/0017's Dashboard addendum), so its
   * typography/spacing were enlarged for comfortable long-session
   * reading. Structure/markup/logic are unchanged; only sizing/spacing
   * values below were bumped up. Blind grading and reveal behavior are
   * untouched — this is a surface change only.
   */
  section {
    max-width: 900px;
    margin: 0 auto 20px;
  }
  h2 {
    font-size: 20px;
    color: #333;
    margin: 0 0 10px;
  }
  h3 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #777;
    margin: 16px 0 6px;
  }
  p,
  ul {
    margin: 8px 0 0;
    padding: 0;
    font-size: 15px;
    line-height: 1.6;
  }
  ul.stats {
    list-style: none;
  }
  .status {
    color: #555;
  }
  .file-label {
    display: block;
    margin-top: 10px;
    font-size: 14px;
  }
  .result {
    margin-top: 14px;
    padding: 16px 20px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fff;
  }
  .response {
    margin-top: 10px;
    padding: 12px 14px;
    background: #fafafa;
    border-radius: 6px;
  }
  .label {
    font-size: 15px;
  }
  .role {
    color: #888;
    font-weight: normal;
  }
  .error {
    color: #b00;
  }
  .dimensions {
    color: #666;
    font-size: 13px;
  }
  .grade-buttons {
    display: flex;
    gap: 14px;
    font-size: 14px;
    margin-top: 8px;
  }
  .note-field {
    display: block;
    margin-top: 10px;
    font-size: 14px;
  }
  .note-field input {
    width: 100%;
    box-sizing: border-box;
    font-size: 15px;
    padding: 8px;
    margin-top: 4px;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  .actions {
    margin-top: 12px;
    display: flex;
    gap: 10px;
  }
  button {
    font-size: 14px;
    margin-top: 10px;
    padding: 10px 16px;
    border-radius: 6px;
  }
  details {
    margin-top: 14px;
    font-size: 14px;
    background: #fafafa;
    border-radius: 8px;
    padding: 12px 16px;
  }
  label {
    display: block;
    margin-top: 8px;
  }
  input[type='password'],
  input[type='text'] {
    width: 100%;
    box-sizing: border-box;
    font-size: 15px;
    padding: 8px;
    margin-top: 4px;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  .note {
    color: #888;
    font-size: 13px;
  }
</style>
