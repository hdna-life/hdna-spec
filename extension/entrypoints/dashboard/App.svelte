<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
  import { JobQueue } from '../../src/queue/job-queue';
  import { RuntimeControls, type RuntimeControlsState } from '../../src/runtime/controls';
  import { FOREGROUND_PORT_NAME } from '../../src/runtime/foreground-tracker';
  import { Trial4TrainingCandidateStore } from '../../src/persona/trial4-training-candidate-store';
  import {
    importTrial4TrainingCandidates,
    clearAllTrial4TrainingCandidates,
    type Trial4ImportMode,
  } from '../../src/persona/trial4-training-candidate-import';
  import { Trial4BenchmarkCaseStore } from '../../src/persona/trial4-benchmark-case-store';
  import { Trial4BenchmarkResultStore } from '../../src/persona/trial4-benchmark-result-store';
  import {
    Trial4BenchmarkConfigStore,
    type Trial4BenchmarkConfig,
  } from '../../src/persona/trial4-benchmark-config-store';
  import { enqueueTrial4BenchmarkCase } from '../../src/queue/processors/trial4-benchmark-job';
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
  import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
  import type { Trial4BenchmarkLabel, Trial4BenchmarkRank, Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';
  import type { BehaviorDimensionChange, SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
  import { isValidDimensionsArray } from '../../src/persona/behavior-dimension';
  import {
    importTrial4BenchmarkCases as importTrial4BenchmarkCasesIntoStore,
    clearTrial4BenchmarkData as clearTrial4BenchmarkDataFromStores,
    type Trial4BenchmarkImportMode,
  } from '../../src/persona/trial4-benchmark-case-import';

  import DashboardOverview from '../../src/ui/dashboard/DashboardOverview.svelte';
  import DashboardTrainingReview from '../../src/ui/dashboard/DashboardTrainingReview.svelte';
  import DashboardExports from '../../src/ui/dashboard/DashboardExports.svelte';
  import DashboardSettings from '../../src/ui/dashboard/DashboardSettings.svelte';
  import Trial4BenchmarkPanel from '../../src/ui/Trial4BenchmarkPanel.svelte';

  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  const controls = new RuntimeControls(storage);
  const trial4TrainingCandidateStore = new Trial4TrainingCandidateStore(storage);
  const trial4BenchmarkCaseStore = new Trial4BenchmarkCaseStore(storage);
  const trial4BenchmarkResultStore = new Trial4BenchmarkResultStore(storage);
  const trial4BenchmarkConfigStore = new Trial4BenchmarkConfigStore();

  type Page = 'overview' | 'review' | 'benchmark' | 'exports' | 'settings';
  let page: Page = 'overview';

  const NAV: { id: Page; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'review', label: 'Training Review' },
    { id: 'benchmark', label: 'Benchmark' },
    { id: 'exports', label: 'Data / Exports' },
    { id: 'settings', label: 'Settings' },
  ];

  let controlsState: RuntimeControlsState = { processingPaused: false, learningPaused: false };
  let trial4TrainingCandidates: Trial4TrainingCandidate[] = [];
  let trial4BenchmarkCases: Trial4BenchmarkCase[] = [];
  let trial4BenchmarkResults: Trial4BenchmarkResult[] = [];
  let trial4BenchmarkConfig: Trial4BenchmarkConfig = { enabled: false };

  async function refresh() {
    controlsState = await controls.get();
    trial4TrainingCandidates = await trial4TrainingCandidateStore.list();
    trial4BenchmarkCases = await trial4BenchmarkCaseStore.list();
    trial4BenchmarkResults = await trial4BenchmarkResultStore.list();
    trial4BenchmarkConfig = await trial4BenchmarkConfigStore.get();
  }

  // --- Training Review -------------------------------------------------

  async function importTrial4Candidates(
    event: CustomEvent<{ candidates: Trial4TrainingCandidate[]; mode: Trial4ImportMode }>,
  ) {
    await importTrial4TrainingCandidates(trial4TrainingCandidateStore, event.detail.candidates, event.detail.mode);
    await refresh();
  }

  async function clearTrial4Candidates() {
    await clearAllTrial4TrainingCandidates(trial4TrainingCandidateStore);
    await refresh();
  }

  async function updateTrial4Candidate(event: CustomEvent<Trial4TrainingCandidate>) {
    await trial4TrainingCandidateStore.put(event.detail);
    await refresh();
  }

  // --- Benchmark ---------------------------------------------------------
  // submitTrial4Judgment/revealTrial4Result intentionally duplicate
  // Trial4BenchmarkService's small grading/reveal logic rather than
  // instantiating that service here — the service exists to run model
  // calls (base/trained/DeepSeek), which only ever happens in the
  // background job (createTrial4BenchmarkProcessor), never from this
  // dashboard tab. Grading/reveal are pure local-storage mutations with
  // no model call involved. Mirrors extension/entrypoints/popup/App.svelte's
  // identical Trial 4 handlers exactly, before they were relocated here.

  async function importTrial4BenchmarkCases(
    event: CustomEvent<{ cases: Trial4BenchmarkCase[]; mode: Trial4BenchmarkImportMode }>,
  ) {
    // Ground truth is deliberately NOT required in an imported file — the
    // operator labels and locks each case in the Dashboard afterward (Test
    // 1 evaluation-stage addendum). Any missing/legacy field is defaulted
    // to "not yet labeled," never inferred from the raw import. 'replace'
    // clears BOTH stores first (a stale result referencing a case id no
    // longer in the store would otherwise silently survive) — cases and
    // results are cleared together, never cases alone.
    if (event.detail.mode === 'replace') {
      await trial4BenchmarkResultStore.clear();
    }
    await importTrial4BenchmarkCasesIntoStore(trial4BenchmarkCaseStore, event.detail.cases, event.detail.mode);
    await refresh();
  }

  async function clearTrial4BenchmarkData() {
    await clearTrial4BenchmarkDataFromStores(trial4BenchmarkCaseStore, trial4BenchmarkResultStore);
    await refresh();
  }

  // Pure local-storage mutation, same "no model call, so no need to
  // instantiate Trial4BenchmarkService here" reasoning as
  // submitTrial4Judgment/revealTrial4Result below — mirrors
  // Trial4BenchmarkService.lockGroundTruth's own validation exactly.
  async function lockGroundTruthCase(
    event: CustomEvent<{ caseId: string; humanVerdict: SemanticChangeVerdict; humanDimensions: BehaviorDimensionChange[] }>,
  ) {
    const { caseId, humanVerdict, humanDimensions } = event.detail;
    const benchmarkCase = await trial4BenchmarkCaseStore.get(caseId);
    if (!benchmarkCase || benchmarkCase.groundTruthLocked) return;

    const validVerdicts: SemanticChangeVerdict[] = [
      'no_meaningful_change',
      'meaning_added',
      'meaning_removed',
      'meaning_transformed',
      'uncertain',
    ];
    if (!validVerdicts.includes(humanVerdict)) return;
    if (!isValidDimensionsArray(humanDimensions)) return;
    if (humanVerdict === 'uncertain' && humanDimensions.length > 0) return;

    await trial4BenchmarkCaseStore.put({
      ...benchmarkCase,
      humanVerdict,
      humanDimensions,
      groundTruthLocked: true,
      groundTruthLockedAt: new Date().toISOString(),
    });
    await refresh();
  }

  async function runTrial4BenchmarkCase() {
    await enqueueTrial4BenchmarkCase(queue);
    await refresh();
  }

  const TRIAL4_LABELS: Trial4BenchmarkLabel[] = ['A', 'B', 'C'];

  async function submitTrial4Judgment(
    event: CustomEvent<{
      resultId: string;
      acceptability: Record<Trial4BenchmarkLabel, { acceptable: boolean; rank: Trial4BenchmarkRank | null }>;
      note: string;
    }>,
  ) {
    const result = await trial4BenchmarkResultStore.get(event.detail.resultId);
    if (!result || result.judged) return;
    const { acceptability, note } = event.detail;

    // Mirrors Trial4BenchmarkService.submitJudgment's validation and
    // derived-bestResponse logic (docs/decisions/0017's "acceptability
    // gate + ranking" addendum) — see this file's Benchmark-section
    // docstring for why this handler doesn't just call that service.
    const acceptableLabels = TRIAL4_LABELS.filter((label) => acceptability[label].acceptable);
    const unacceptableLabels = TRIAL4_LABELS.filter((label) => !acceptability[label].acceptable);
    if (unacceptableLabels.some((label) => acceptability[label].rank !== null)) return;
    const ranks = acceptableLabels.map((label) => acceptability[label].rank);
    if (ranks.some((rank) => rank === null)) return;
    const expectedRanks = acceptableLabels.map((_label, index) => index + 1);
    if (JSON.stringify([...ranks].sort()) !== JSON.stringify(expectedRanks)) return;
    const bestResponse = acceptableLabels.find((label) => acceptability[label].rank === 1) ?? null;

    const updated: Trial4BenchmarkResult = {
      ...result,
      labelMapping: {
        A: { ...result.labelMapping.A, humanAcceptable: acceptability.A.acceptable, humanRank: acceptability.A.rank },
        B: { ...result.labelMapping.B, humanAcceptable: acceptability.B.acceptable, humanRank: acceptability.B.rank },
        C: { ...result.labelMapping.C, humanAcceptable: acceptability.C.acceptable, humanRank: acceptability.C.rank },
      },
      bestResponse,
      note,
      judged: true,
      judgedAt: new Date().toISOString(),
    };
    await trial4BenchmarkResultStore.put(updated);
    await refresh();
  }

  async function revealTrial4Result(event: CustomEvent<string>) {
    const result = await trial4BenchmarkResultStore.get(event.detail);
    // Model identities must remain hidden until the blind evaluation is
    // committed (Test 1 evaluation-stage addendum) — mirrors
    // Trial4BenchmarkService.reveal's own guard.
    if (!result || !result.judged) return;
    await trial4BenchmarkResultStore.put({ ...result, revealed: true });
    await refresh();
  }

  async function saveTrial4BenchmarkConfig(event: CustomEvent<Trial4BenchmarkConfig>) {
    await trial4BenchmarkConfigStore.set(event.detail);
    await refresh();
  }

  // --- Settings ---------------------------------------------------------

  async function toggleProcessing() {
    if (controlsState.processingPaused) await controls.resumeProcessing();
    else await controls.pauseProcessing();
    await refresh();
  }

  async function toggleLearning() {
    if (controlsState.learningPaused) await controls.resumeLearning();
    else await controls.pauseLearning();
    await refresh();
  }

  let interval: ReturnType<typeof setInterval>;
  let foregroundPort: chrome.runtime.Port | undefined;
  onMount(() => {
    // Same foreground-signal discipline as the popup — a long-lived
    // dashboard tab should also keep the background dispatch loop out of
    // DEEP_IDLE while the operator is actively reviewing/benchmarking.
    foregroundPort = chrome.runtime.connect({ name: FOREGROUND_PORT_NAME });
    refresh();
    interval = setInterval(refresh, 2000);
  });
  onDestroy(() => {
    clearInterval(interval);
    foregroundPort?.disconnect();
  });
</script>

<div class="shell">
  <nav class="sidebar">
    <h1>HDNA</h1>
    <ul>
      {#each NAV as item}
        <li>
          <button class:active={page === item.id} on:click={() => (page = item.id)}>{item.label}</button>
        </li>
      {/each}
    </ul>
  </nav>

  <main class="content">
    {#if page === 'overview'}
      <DashboardOverview candidates={trial4TrainingCandidates} benchmarkResults={trial4BenchmarkResults} />
    {:else if page === 'review'}
      <DashboardTrainingReview
        candidates={trial4TrainingCandidates}
        on:importCandidates={importTrial4Candidates}
        on:update={updateTrial4Candidate}
        on:clearAll={clearTrial4Candidates}
      />
    {:else if page === 'benchmark'}
      <Trial4BenchmarkPanel
        cases={trial4BenchmarkCases}
        results={trial4BenchmarkResults}
        config={trial4BenchmarkConfig}
        on:importCases={importTrial4BenchmarkCases}
        on:clearBenchmarkData={clearTrial4BenchmarkData}
        on:lockGroundTruth={lockGroundTruthCase}
        on:runNextCase={runTrial4BenchmarkCase}
        on:submitJudgment={submitTrial4Judgment}
        on:reveal={revealTrial4Result}
        on:saveConfig={saveTrial4BenchmarkConfig}
      />
    {:else if page === 'exports'}
      <DashboardExports candidates={trial4TrainingCandidates} />
    {:else if page === 'settings'}
      <DashboardSettings {controlsState} on:toggleProcessing={toggleProcessing} on:toggleLearning={toggleLearning} />
    {/if}
  </main>
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    font-family:
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;
    color: #222;
    background: #fff;
  }
  .shell {
    display: flex;
    min-height: 100vh;
  }
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: #f5f5f5;
    border-right: 1px solid #e0e0e0;
    padding: 24px 16px;
    box-sizing: border-box;
  }
  .sidebar h1 {
    font-size: 20px;
    margin: 0 0 20px 8px;
    letter-spacing: 0.02em;
  }
  .sidebar ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sidebar li {
    margin-bottom: 4px;
  }
  .sidebar button {
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    font-size: 15px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #333;
    cursor: pointer;
  }
  .sidebar button:hover {
    background: #e9e9e9;
  }
  .sidebar button.active {
    background: #2a6b3f;
    color: #fff;
    font-weight: 600;
  }
  .content {
    flex: 1;
    padding: 40px 48px;
    box-sizing: border-box;
    max-width: 1200px;
  }
</style>
