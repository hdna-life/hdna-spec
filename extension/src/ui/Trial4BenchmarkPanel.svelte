<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
  import type { Trial4BenchmarkLabel, Trial4BenchmarkRank, Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';
  import type { BehaviorDimension, BehaviorDimensionChange, BehaviorDirection, SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
  import type { Job } from '@spec/protocol/job';
  import type { Trial4BenchmarkConfig } from '../persona/trial4-benchmark-config-store';
  import { computeTrial4BenchmarkStats } from '../persona/trial4-benchmark-stats';
  import { CANONICAL_DIMENSION_DIRECTIONS } from '../persona/behavior-dimension';
  import type { Trial4BenchmarkImportMode } from '../persona/trial4-benchmark-case-import';
  import {
    DIMENSION_LABELS_TR,
    DIRECTION_LABELS_TR,
    DIMENSION_GROUPS_TR,
    VERDICT_LABELS_TR,
    VERDICT_ORDER,
  } from '../persona/trial4-review-state';

  export let cases: Trial4BenchmarkCase[] = [];
  export let results: Trial4BenchmarkResult[] = [];
  export let config: Trial4BenchmarkConfig = { enabled: false };
  /**
   * The most recent run_trial4_benchmark_case job's own record (status +
   * lastError), if any — surfaced so a job that throws before ever calling
   * a provider (e.g. missing config) or a real provider/network failure is
   * visible to the operator, instead of "Run next case" silently doing
   * nothing with no explanation. Undefined until the button has been
   * clicked at least once.
   */
  export let lastJob: Job | undefined = undefined;

  interface AcceptabilityEntry {
    acceptable: boolean | null;
    rank: Trial4BenchmarkRank | null;
  }

  const dispatch = createEventDispatcher<{
    importCases: { cases: Trial4BenchmarkCase[]; mode: Trial4BenchmarkImportMode };
    clearBenchmarkData: void;
    lockGroundTruth: { caseId: string; humanVerdict: SemanticChangeVerdict; humanDimensions: BehaviorDimensionChange[] };
    runNextCase: void;
    resetStuckJob: void;
    submitJudgment: {
      resultId: string;
      acceptability: Record<Trial4BenchmarkLabel, { acceptable: boolean; rank: Trial4BenchmarkRank | null }>;
      note: string;
    };
    reveal: string;
    saveConfig: Trial4BenchmarkConfig;
  }>();

  const LABELS: Trial4BenchmarkLabel[] = ['A', 'B', 'C'];

  // English canonical labels, paired with the SAME Turkish labels Training
  // Review's "NE DEĞİŞTİ?" section already uses (trial4-review-state.ts) —
  // reused, never duplicated/retranslated, so the two UIs can never drift
  // into inconsistent Turkish wording for the same enum value. This panel
  // displays "English canonical (Türkçe)" throughout its ground-truth and
  // response sections; only the persisted value is the English enum.
  const VERDICT_LABELS_EN: Record<SemanticChangeVerdict, string> = {
    meaning_added: 'Meaning added',
    meaning_removed: 'Meaning removed',
    meaning_transformed: 'Meaning transformed',
    no_meaningful_change: 'No meaningful change',
    uncertain: 'Uncertain',
  };
  function verdictLabel(verdict: SemanticChangeVerdict): string {
    return `${VERDICT_LABELS_EN[verdict]} (${VERDICT_LABELS_TR[verdict]})`;
  }

  const DIMENSION_GROUP_LABELS_EN = ['Expression / tone', 'Stance', 'Meaning / practical content'];
  const DIMENSION_LABELS_EN: Record<BehaviorDimension, string> = {
    expressed_affect_valence: 'Expressed affect valence',
    expressed_affect_intensity: 'Expressed affect intensity',
    directness: 'Directness',
    politeness: 'Politeness',
    formality: 'Formality',
    certainty: 'Certainty',
    evidentiality: 'Evidentiality',
    commitment: 'Commitment',
    directive_force: 'Directive force',
    conditionality: 'Conditionality',
    scope: 'Scope',
    specificity: 'Specificity',
    rationale: 'Rationale',
    factual_content: 'Factual content',
    action_or_decision: 'Action / decision',
  };
  function dimensionLabel(dimension: BehaviorDimension): string {
    return `${DIMENSION_LABELS_EN[dimension]} (${DIMENSION_LABELS_TR[dimension]})`;
  }

  const DIRECTION_LABELS_EN: Record<BehaviorDirection, string> = {
    increased: 'Increased',
    decreased: 'Decreased',
    more_positive: 'More positive',
    more_negative: 'More negative',
    added: 'Added',
    removed: 'Removed',
    narrowed: 'Narrowed',
    expanded: 'Expanded',
    changed: 'Changed',
  };
  function directionLabel(direction: BehaviorDirection): string {
    return `${DIRECTION_LABELS_EN[direction]} (${DIRECTION_LABELS_TR[direction]})`;
  }

  // The canonical, NORMATIVELY-ENFORCED per-dimension direction mapping
  // (productization cleanup phase 2 — `isValidDimensionsArray` now
  // rejects a pair outside this mapping for every provider too, not just
  // ground-truth entry). Reused directly from `behavior-dimension.ts`
  // rather than duplicated here, so this UI can never drift out of sync
  // with what the runtime actually accepts.
  const GROUND_TRUTH_DIRECTIONS_BY_DIMENSION = CANONICAL_DIMENSION_DIRECTIONS;

  // Test 1's central question is not "does trained Qwen beat DeepSeek" — it
  // is base->trained improvement and acceptable-local-judge quality under
  // the v3 contract (docs/decisions/0017's "acceptability gate + ranking"
  // addendum). `cases` is passed through for frozen humanVerdict/
  // humanDimensions ground-truth accuracy, when locked.
  $: stats = computeTrial4BenchmarkStats(results, cases);
  $: unjudged = results.find((r) => !r.judged);
  $: benchmarkedCaseIds = new Set(results.map((r) => r.caseId));
  $: unlockedCases = cases.filter((c) => !c.groundTruthLocked);
  $: lockedCases = cases.filter((c) => c.groundTruthLocked);
  $: readyToRunCases = lockedCases.filter((c) => !benchmarkedCaseIds.has(c.id)).length;
  $: judgedResults = results.filter((r) => r.judged).slice().reverse();
  // Looks up the benchmark case behind a result's caseId, so the operator
  // can see WHICH revision they're grading without navigating back to the
  // ground-truth section — never used to look up or display anything about
  // which system (base/trained/deepseek) produced a response; that stays
  // gated on `result.revealed` exactly as before.
  $: casesById = new Map(cases.map((c) => [c.id, c]));

  // --- Ground truth entry + lock (Test 1 evaluation-stage addendum). A
  // model must never run against, and the operator must never blind-grade
  // against, a case whose ground truth isn't locked yet — see
  // Trial4BenchmarkService.runNextCase/lockGroundTruth. Nothing here is
  // saved until "LOCK GROUND TRUTH" is pressed; DeepSeek/model proposed
  // labels are never shown at this stage (this schema never carries any). ---
  let gtIndex = 0;
  $: groundTruthCase = unlockedCases[Math.min(gtIndex, Math.max(unlockedCases.length - 1, 0))];
  let gtVerdict: SemanticChangeVerdict | null = null;
  // Selected dimensions and their chosen direction are tracked separately
  // (rather than eagerly defaulting every checked dimension to some
  // direction) so an operator who has checked a dimension but not yet
  // picked a valid direction for it is visibly blocked from locking —
  // never silently defaulted to a placeholder direction.
  let gtSelectedDimensions: BehaviorDimension[] = [];
  let gtDirectionByDimension: Partial<Record<BehaviorDimension, BehaviorDirection>> = {};
  let lastGtCaseId: string | undefined;
  $: {
    if (groundTruthCase?.id !== lastGtCaseId) {
      lastGtCaseId = groundTruthCase?.id;
      gtVerdict = null;
      gtSelectedDimensions = [];
      gtDirectionByDimension = {};
    }
  }

  function selectGtVerdict(verdict: SemanticChangeVerdict) {
    gtVerdict = verdict;
    if (verdict === 'uncertain') {
      gtSelectedDimensions = [];
      gtDirectionByDimension = {};
    }
  }

  function toggleGtDimension(dimension: BehaviorDimension) {
    if (gtSelectedDimensions.includes(dimension)) {
      gtSelectedDimensions = gtSelectedDimensions.filter((d) => d !== dimension);
      const rest = { ...gtDirectionByDimension };
      delete rest[dimension];
      gtDirectionByDimension = rest;
    } else {
      gtSelectedDimensions = [...gtSelectedDimensions, dimension];
    }
  }

  function setGtDirection(dimension: BehaviorDimension, direction: BehaviorDirection) {
    gtDirectionByDimension = { ...gtDirectionByDimension, [dimension]: direction };
  }

  // A selected dimension with no direction chosen yet (or, defensively, a
  // direction outside its allowed set) makes the whole draft un-lockable —
  // see this component's GROUND_TRUTH_DIRECTIONS_BY_DIMENSION docstring.
  $: gtDimensionsValid = gtSelectedDimensions.every((dimension) => {
    const direction = gtDirectionByDimension[dimension];
    return direction !== undefined && GROUND_TRUTH_DIRECTIONS_BY_DIMENSION[dimension].includes(direction);
  });
  $: gtDimensions = gtSelectedDimensions.map((dimension) => ({
    dimension,
    direction: gtDirectionByDimension[dimension]!,
  }));
  $: canLockGroundTruth = gtVerdict !== null && gtDimensionsValid;

  function lockGroundTruth() {
    if (!groundTruthCase || !canLockGroundTruth || gtVerdict === null) return;
    dispatch('lockGroundTruth', { caseId: groundTruthCase.id, humanVerdict: gtVerdict, humanDimensions: gtDimensions });
    if (gtIndex < unlockedCases.length - 1) gtIndex += 1;
  }

  // --- settings form (same hydration-safety discipline as every other
  // experimental settings block in this codebase — see
  // semantic-revision-judge-form-state.ts's docstring). ---
  let baseModelUrlInput = '';
  let trainedModelUrlInput = '';
  let localModelIdInput = '';
  let openRouterApiKeyInput = '';
  let deepSeekModelIdInput = '';
  let enabledInput = false;
  let dirty = false;

  $: hasOpenRouterApiKey = Boolean(config.openRouterApiKey);

  $: {
    if (!dirty) {
      baseModelUrlInput = config.baseModelUrl ?? '';
      trainedModelUrlInput = config.trainedModelUrl ?? '';
      localModelIdInput = config.localModelId ?? '';
      openRouterApiKeyInput = '';
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
      openRouterApiKey: openRouterApiKeyInput.trim() || config.openRouterApiKey,
      deepSeekModelId: deepSeekModelIdInput.trim() || undefined,
    });
    openRouterApiKeyInput = '';
  }

  // --- import (append/replace) + clear (docs/decisions/0017 Test 1
  // "benchmark data management" addendum). Mirrors DashboardTrainingReview's
  // established append/replace-file-input + confirm-then-dispatch pattern
  // exactly, so operators get one consistent import UX across the
  // Dashboard rather than two different conventions. ---
  async function handleImportFile(event: Event, mode: Trial4BenchmarkImportMode) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Selected file is not valid JSON.');
      input.value = '';
      return;
    }
    if (!Array.isArray(parsed)) {
      alert('Expected a JSON array of benchmark case objects.');
      input.value = '';
      return;
    }
    if (mode === 'replace') {
      const confirmed = confirm(
        'This will DELETE every currently imported benchmark case AND every result run against them, then import this file. This cannot be undone. Continue?',
      );
      if (!confirmed) {
        input.value = '';
        return;
      }
    }
    dispatch('importCases', { cases: parsed as Trial4BenchmarkCase[], mode });
    input.value = '';
  }

  function handleClearBenchmarkData() {
    const confirmed = confirm(
      'This will permanently delete ALL imported Trial 4 benchmark cases and ALL run/judged results. This cannot be undone. Continue?',
    );
    if (!confirmed) return;
    dispatch('clearBenchmarkData');
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

  // Reset the judging form ONLY when a genuinely different result becomes
  // current — compared by id, not by object identity. `results` (and
  // therefore `unjudged`) is a brand-new array/object on every poll tick
  // (App.svelte's `setInterval(refresh, 2000)` re-fetches from storage),
  // so a Svelte `$:` block that merely references `unjudged` — even just
  // `unjudged?.id` — reruns on every such reassignment regardless of
  // whether the id actually changed, silently wiping in-progress
  // Acceptable/Unacceptable/Rank selections every couple of seconds. This
  // explicit lastUnjudgedId comparison is the fix, mirroring the
  // groundTruthCase/lastGtCaseId guard above.
  let lastUnjudgedId: string | undefined;
  $: {
    if (unjudged?.id !== lastUnjudgedId) {
      lastUnjudgedId = unjudged?.id;
      acceptability = {
        A: { acceptable: null, rank: null },
        B: { acceptable: null, rank: null },
        C: { acceptable: null, rank: null },
      };
      note = '';
    }
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

  // A plain `function canSubmit() {...}` called from the template
  // (`disabled={!canSubmit()}`) is NOT reactive in Svelte — the compiler
  // only re-evaluates a template expression when one of the REACTIVE
  // identifiers it references changes, and a bare function reference is
  // never itself invalidated. The button's `disabled` value was frozen at
  // its first-render result (`true`, since `acceptability` starts all
  // null) and never updated again no matter what the operator selected —
  // this is the "Submit judgment is always disabled" bug. Fixed by making
  // this an actual `$:` derived value that reads `acceptability`/
  // `acceptableLabels` directly, so Svelte tracks it correctly.
  $: canSubmit = (() => {
    if (LABELS.some((label) => acceptability[label].acceptable === null)) return false;
    const ranks = acceptableLabels.map((label) => acceptability[label].rank);
    if (ranks.some((rank) => rank === null)) return false;
    const expected = acceptableLabels.map((_label, index) => index + 1);
    return JSON.stringify([...ranks].sort()) === JSON.stringify(expected);
  })();

  function submit() {
    if (!unjudged || !canSubmit) return;
    const payload: Record<Trial4BenchmarkLabel, { acceptable: boolean; rank: Trial4BenchmarkRank | null }> = {
      A: { acceptable: acceptability.A.acceptable === true, rank: acceptability.A.rank },
      B: { acceptable: acceptability.B.acceptable === true, rank: acceptability.B.rank },
      C: { acceptable: acceptability.C.acceptable === true, rank: acceptability.C.rank },
    };
    dispatch('submitJudgment', { resultId: unjudged.id, acceptability: payload, note });
  }

  // Reveal Models is deliberately gated in this template on
  // `judgedResult.judged` (never merely on the result existing) — the
  // control is not rendered at all before commit, so there is no disabled
  // button to route around; Trial4BenchmarkService.reveal enforces the
  // same rule server-side as a second, structural guard.
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
    Imported: <strong>{cases.length}</strong> ·
    Unlocked: <strong>{unlockedCases.length}</strong> ·
    Locked (ready to run): <strong>{readyToRunCases}</strong> ·
    Run: <strong>{results.length}</strong> ·
    Judged: <strong>{stats.judgedResultCount}</strong>
  </p>

  <div class="import-group">
    <label class="import-label">
      Import — append to existing cases
      <input type="file" accept="application/json" on:change={(e) => handleImportFile(e, 'append')} />
    </label>
    <label class="import-label">
      Import — replace all cases + results
      <input type="file" accept="application/json" on:change={(e) => handleImportFile(e, 'replace')} />
    </label>
    <button class="danger" on:click={handleClearBenchmarkData}>Clear benchmark data</button>
  </div>
  <p class="note">
    Cases may be imported without ground truth; label and lock them below
    before running models. "Replace" and "Clear benchmark data" delete
    existing cases AND results and cannot be undone.
  </p>

  <h3>Ground truth ({unlockedCases.length} unlocked)</h3>
  <p class="note">
    Select the semantic verdict, then zero or more dimension + direction
    pairs, then lock. Once locked, ground truth cannot be changed through
    this UI, and only locked cases become eligible to run.
  </p>
  {#if groundTruthCase}
    <div class="result gt-block">
      <p class="note">Case: {groundTruthCase.id} ({gtIndex + 1} / {unlockedCases.length})</p>
      <div class="reconstruction">
        <p><strong>BEFORE:</strong> {groundTruthCase.beforeContext} <span class="highlight">{groundTruthCase.originalText}</span> {groundTruthCase.afterContext}</p>
        <p><strong>AFTER:</strong> {groundTruthCase.beforeContext} <span class="highlight">{groundTruthCase.finalText}</span> {groundTruthCase.afterContext}</p>
      </div>

      <p class="note"><strong>Semantic verdict:</strong></p>
      <div class="grade-buttons">
        {#each VERDICT_ORDER as verdict}
          <label>
            <input type="radio" name="gt-verdict" checked={gtVerdict === verdict} on:change={() => selectGtVerdict(verdict)} />
            {verdictLabel(verdict)}
          </label>
        {/each}
      </div>

      <p class="note"><strong>Behavioral dimensions:</strong> (disabled when verdict is Uncertain)</p>
      {#each DIMENSION_GROUPS_TR as group, groupIndex}
        <div class="dimension-group">
          <p class="dimension-group-label">{DIMENSION_GROUP_LABELS_EN[groupIndex]} ({group.label})</p>
          <div class="dimension-grid">
            {#each group.dimensions as dimension}
              {@const selected = gtSelectedDimensions.includes(dimension)}
              {@const chosenDirection = gtDirectionByDimension[dimension]}
              <div class="dimension-item">
                <label>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={gtVerdict === 'uncertain'}
                    on:change={() => toggleGtDimension(dimension)}
                  />
                  {dimensionLabel(dimension)}
                </label>
                {#if selected}
                  <select
                    value={chosenDirection ?? ''}
                    on:change={(e) => setGtDirection(dimension, (e.target as HTMLSelectElement).value as BehaviorDirection)}
                  >
                    <option value="" disabled>— select direction —</option>
                    {#each GROUND_TRUTH_DIRECTIONS_BY_DIMENSION[dimension] as direction}
                      <option value={direction}>{directionLabel(direction)}</option>
                    {/each}
                  </select>
                  {#if !chosenDirection}
                    <span class="error">direction required</span>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}

      <div class="actions">
        <button on:click={lockGroundTruth} disabled={!canLockGroundTruth}>LOCK GROUND TRUTH</button>
        {#if unlockedCases.length > 1}
          <button on:click={() => (gtIndex = (gtIndex + 1) % unlockedCases.length)}>Skip to next unlocked case</button>
        {/if}
      </div>
      {#if gtVerdict === null}
        <p class="note error">Select a semantic verdict to enable locking.</p>
      {:else if !gtDimensionsValid}
        <p class="note error">Every selected dimension needs a direction before you can lock.</p>
      {/if}
    </div>
  {:else}
    <p>No unlocked cases. Import cases, or all imported cases already have locked ground truth.</p>
  {/if}

  <button on:click={() => dispatch('runNextCase')} disabled={readyToRunCases <= 0}>
    Run next case ({readyToRunCases} locked case(s) ready)
  </button>
  {#if lastJob}
    <p class="note job-status" class:job-status-error={lastJob.status === 'FAILED'}>
      Last run job: <strong>{lastJob.status}</strong>
      {#if lastJob.attempts > 1}(attempt {lastJob.attempts}){/if}
      {#if lastJob.status === 'FAILED' && lastJob.lastError}
        — {lastJob.lastError}
      {:else if lastJob.status === 'RUNNING'}
        — in progress, calling Base/Trained/DeepSeek now
      {/if}
    </p>
    {#if lastJob.status === 'RUNNING'}
      <p class="note">
        If this has been RUNNING for more than a minute or two with no
        result appearing, the background service worker likely died
        mid-request (real Chrome behavior for long-running local-model
        calls) — the job is stuck, not actually in progress.
        <button on:click={() => dispatch('resetStuckJob')}>Reset stuck job</button>
      </p>
    {/if}
  {/if}

  {#if unjudged}
    {@const unjudgedCase = casesById.get(unjudged.caseId)}
    <div class="result">
      <div class="case-context">
        <p class="case-context-label">Case: {unjudged.caseId}</p>
        {#if unjudgedCase}
          <p class="context-label">BEFORE:</p>
          <p class="context-text">{unjudgedCase.originalText}</p>
          <p class="context-label">AFTER:</p>
          <p class="context-text">{unjudgedCase.finalText}</p>
          {#if unjudgedCase.beforeContext || unjudgedCase.afterContext}
            <p class="note context-surrounding">
              {#if unjudgedCase.beforeContext}…{unjudgedCase.beforeContext}…{/if}
              {#if unjudgedCase.afterContext}&nbsp;…{unjudgedCase.afterContext}…{/if}
            </p>
          {/if}
        {:else}
          <p class="note error">Case data not found for {unjudged.caseId} (it may have been cleared).</p>
        {/if}
      </div>
      <p class="note">
        Mark each response acceptable or unacceptable, then rank the
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
            <p><strong>verdict:</strong> {responseItem.verdict !== null ? verdictLabel(responseItem.verdict) : '—'}</p>
            {#if responseItem.dimensions.length > 0}
              <p class="dimensions">
                dimensions:
                {#each responseItem.dimensions as change, i}{i > 0 ? ', ' : ' '}{dimensionLabel(change.dimension)}: {directionLabel(change.direction)}{/each}
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
        <button on:click={submit} disabled={!canSubmit}>Submit judgment</button>
      </div>
    </div>
  {:else}
    <p>No in-progress case. Click "Run next case" to benchmark the next held-out case.</p>
  {/if}

  <h3>Judged cases ({judgedResults.length})</h3>
  <p class="note">
    Model identities stay hidden until the blind evaluation above is
    committed — reveal only becomes available here, after judging, and
    never changes any recorded judgment.
  </p>
  {#if judgedResults.length === 0}
    <p>No judged cases yet.</p>
  {:else}
    <ul class="judged-list">
      {#each judgedResults as judgedResult}
        {@const judgedCase = casesById.get(judgedResult.caseId)}
        <li class="judged-item">
          <div class="judged-item-row">
            <span class="judged-case">{judgedResult.caseId}</span>
            {#if judgedResult.note}<span class="note"> — {judgedResult.note}</span>{/if}
            {#if judgedResult.revealed}
              <span class="role">
                ({LABELS.map((l) => `${l}: ${roleLabel(judgedResult.labelMapping[l].role)}`).join(', ')})
              </span>
            {:else}
              <button on:click={() => revealResult(judgedResult.id)}>Reveal models</button>
            {/if}
          </div>
          {#if judgedCase}
            <details class="case-context-details">
              <summary>Show case text</summary>
              <div class="case-context">
                <p class="context-label">BEFORE:</p>
                <p class="context-text">{judgedCase.originalText}</p>
                <p class="context-label">AFTER:</p>
                <p class="context-text">{judgedCase.finalText}</p>
                {#if judgedCase.beforeContext || judgedCase.afterContext}
                  <p class="note context-surrounding">
                    {#if judgedCase.beforeContext}…{judgedCase.beforeContext}…{/if}
                    {#if judgedCase.afterContext}&nbsp;…{judgedCase.afterContext}…{/if}
                  </p>
                {/if}
              </div>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h3>Aggregate results</h3>
  <p class="note">
    DeepSeek is a <strong>frontier reference</strong>, not a success condition — trained Qwen does
    not need to beat it. The central result is the trained-vs-base semantic-accuracy improvement and
    whether trained Qwen reaches an acceptable local-judge quality level.
  </p>
  <div class="table-wrap">
    <table class="agg-table">
      <thead>
        <tr>
          <th></th>
          <th>Base</th>
          <th>Trained</th>
          <th>DeepSeek (frontier ref.)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Semantic exact accuracy</td>
          <td>{stats.base.verdictAccuracyCount > 0 ? (stats.base.verdictAccuracy! * 100).toFixed(0) + '%' : '—'}</td>
          <td>{stats.trained.verdictAccuracyCount > 0 ? (stats.trained.verdictAccuracy! * 100).toFixed(0) + '%' : '—'}</td>
          <td>{stats.deepseek.verdictAccuracyCount > 0 ? (stats.deepseek.verdictAccuracy! * 100).toFixed(0) + '%' : '—'}</td>
        </tr>
        <tr>
          <td>Dimension exact-set accuracy</td>
          <td>{stats.base.dimensionGroundTruthCount > 0 ? (stats.base.dimensionExactSetAccuracy! * 100).toFixed(0) + '%' : '—'}</td>
          <td>{stats.trained.dimensionGroundTruthCount > 0 ? (stats.trained.dimensionExactSetAccuracy! * 100).toFixed(0) + '%' : '—'}</td>
          <td>{stats.deepseek.dimensionGroundTruthCount > 0 ? (stats.deepseek.dimensionExactSetAccuracy! * 100).toFixed(0) + '%' : '—'}</td>
        </tr>
        <tr>
          <td>Dimension micro-F1</td>
          <td>{stats.base.dimensionGroundTruthCount > 0 ? stats.base.dimensionMicroF1!.toFixed(2) : '—'}</td>
          <td>{stats.trained.dimensionGroundTruthCount > 0 ? stats.trained.dimensionMicroF1!.toFixed(2) : '—'}</td>
          <td>{stats.deepseek.dimensionGroundTruthCount > 0 ? stats.deepseek.dimensionMicroF1!.toFixed(2) : '—'}</td>
        </tr>
        <tr>
          <td>Acceptable rate (human)</td>
          <td>{(stats.base.acceptableRate * 100).toFixed(0)}% ({stats.base.acceptableCount}/{stats.base.acceptabilityJudgedCount})</td>
          <td>{(stats.trained.acceptableRate * 100).toFixed(0)}% ({stats.trained.acceptableCount}/{stats.trained.acceptabilityJudgedCount})</td>
          <td>{(stats.deepseek.acceptableRate * 100).toFixed(0)}% ({stats.deepseek.acceptableCount}/{stats.deepseek.acceptabilityJudgedCount})</td>
        </tr>
        <tr>
          <td>Rank-1 count / rate</td>
          <td>{stats.base.rank1Count} ({(stats.base.rank1Rate * 100).toFixed(0)}%)</td>
          <td>{stats.trained.rank1Count} ({(stats.trained.rank1Rate * 100).toFixed(0)}%)</td>
          <td>{stats.deepseek.rank1Count} ({(stats.deepseek.rank1Rate * 100).toFixed(0)}%)</td>
        </tr>
        <tr>
          <td>Provider errors</td>
          <td>{stats.base.errors}</td>
          <td>{stats.trained.errors}</td>
          <td>{stats.deepseek.errors}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="note">
    <strong>Trained vs. base semantic accuracy improvement:</strong>
    {stats.base.verdictAccuracyCount > 0 && stats.trained.verdictAccuracyCount > 0
      ? ((stats.trained.verdictAccuracy! - stats.base.verdictAccuracy!) * 100).toFixed(1) + ' points'
      : 'not yet available (needs locked ground truth for both roles)'}
    · <strong>Trained vs. base acceptability improvement:</strong> {(stats.trainedVsBaseImprovement * 100).toFixed(1)} points
  </p>
  <p class="note">
    No acceptable response in {stats.noAcceptableResponseCount} judged case(s).
  </p>

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
      OpenRouter API key{#if hasOpenRouterApiKey}<span class="note"> (already saved — leave blank to keep it)</span>{/if}
      <input
        type="password"
        bind:value={openRouterApiKeyInput}
        on:input={markDirty}
        placeholder={hasOpenRouterApiKey ? '•••••••• (saved)' : 'sk-or-...'}
      />
      <span class="note">
        Used only for the DeepSeek/frontier-reference role, sent only to
        https://openrouter.ai/api/v1/chat/completions — never DeepSeek's own
        API.
      </span>
    </label>
    <label>
      DeepSeek/OpenRouter model id
      <input type="text" bind:value={deepSeekModelIdInput} on:input={markDirty} placeholder="deepseek/deepseek-v4-flash-0731" />
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
   * reading. Blind grading and reveal behavior are untouched — this is
   * a surface + ground-truth-entry change only.
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
  .status {
    color: #555;
  }
  .import-group {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .import-label {
    display: block;
    font-size: 13px;
    color: #555;
  }
  button.danger {
    background: #b00020;
    color: #fff;
    border: none;
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
    flex-wrap: wrap;
  }
  .gt-block {
    background: #fffef5;
    border-color: #e0d9a0;
  }
  .reconstruction p {
    margin: 6px 0 0;
    font-size: 15px;
    line-height: 1.6;
  }
  .highlight {
    background: #fff3c4;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 600;
  }
  .dimension-group {
    margin-top: 10px;
  }
  .dimension-group-label {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
    color: #555;
  }
  .dimension-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 6px;
  }
  .dimension-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    flex-wrap: wrap;
  }
  .dimension-item select {
    font-size: 12px;
  }
  .dimension-item .error {
    font-size: 11px;
  }
  .table-wrap {
    overflow-x: auto;
    margin-top: 10px;
  }
  .agg-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
  }
  .agg-table th,
  .agg-table td {
    border: 1px solid #e0e0e0;
    padding: 6px 10px;
    text-align: left;
  }
  .agg-table th {
    background: #f5f5f5;
  }
  .judged-list {
    list-style: none;
    padding: 0;
  }
  .judged-item {
    padding: 8px 0;
    border-bottom: 1px solid #eee;
    font-size: 14px;
  }
  .judged-item-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .judged-case {
    font-weight: 600;
  }
  .case-context-details {
    margin-top: 6px;
    font-size: 13px;
  }
  .case-context-details summary {
    cursor: pointer;
    color: #888;
  }
  .case-context {
    margin-top: 6px;
  }
  .context-label {
    margin: 6px 0 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #999;
  }
  .context-text {
    margin: 2px 0 0;
    font-size: 15px;
    line-height: 1.5;
    background: #fff3c4;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
  }
  .context-surrounding {
    margin-top: 6px;
    font-style: italic;
  }
  .case-context-label {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #555;
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
  .job-status {
    margin-top: 6px;
  }
  .job-status-error {
    color: #b00;
  }
</style>
