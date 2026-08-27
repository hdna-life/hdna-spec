<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
  import { JobQueue } from '../../src/queue/job-queue';
  import { RuntimeControls, type RuntimeControlsState } from '../../src/runtime/controls';
  import { RuntimeStatusStore, type RuntimeStatus } from '../../src/runtime/status';
  import { FOREGROUND_PORT_NAME } from '../../src/runtime/foreground-tracker';
  import { WritingSampleStore } from '../../src/persona/sample-store';
  import { ExpressionSheetStore } from '../../src/persona/expression-sheet-store';
  import { EditEventStore } from '../../src/persona/edit-event-store';
  import { EditProfileStore } from '../../src/persona/edit-profile-store';
  import { captureEditEvent } from '../../src/persona/capture';
  import { EmbeddingStore } from '../../src/persona/embedding-store';
  import { HashingEmbeddingProvider } from '../../src/persona/hashing-embedding-provider';
  import { VectorIndexService } from '../../src/persona/vector-index-service';
  import type { ScoredEmbedding } from '../../src/persona/vector-index';
  import {
    enqueueEmbeddingIndex,
    enqueueVectorIndexRebuild,
  } from '../../src/queue/processors/embedding-jobs';
  import { T2ProfileStore } from '../../src/persona/t2-profile-store';
  import { TraitScoreStore } from '../../src/persona/trait-score-store';
  import {
    enqueueEvidenceClassification,
    enqueueT2ProfileRebuild,
  } from '../../src/queue/processors/trait-classification-jobs';
  import { PatternStore } from '../../src/persona/pattern-store';
  import { enqueuePatternCompilation } from '../../src/queue/processors/pattern-compilation-job';
  import { TraitBeliefStore } from '../../src/persona/trait-belief-store';
  import {
    PersonaInterpreterConfigStore,
    type PersonaInterpreterConfig,
  } from '../../src/persona/persona-interpreter-config-store';
  import { enqueuePersonaInterpretation } from '../../src/queue/processors/persona-interpretation-job';
  import { isEligibleForInterpretation } from '../../src/persona/persona-interpreter';
  import { DEFAULT_PERSONA_INTERPRETER_POLICY } from '@spec/schema/persona-interpreter-policy';
  import { SemanticDeltaCandidateStore } from '../../src/persona/semantic-delta-candidate-store';
  import { SemanticDeltaExtractionReceiptStore } from '../../src/persona/semantic-delta-extraction-receipt-store';
  import {
    SemanticDeltaExtractorConfigStore,
    type SemanticDeltaExtractorConfig,
  } from '../../src/persona/semantic-delta-extractor-config-store';
  import { enqueueSemanticDeltaExtraction } from '../../src/queue/processors/semantic-delta-extraction-job';
  import {
    SemanticRevisionJudgeConfigStore,
    type SemanticRevisionJudgeConfig,
  } from '../../src/persona/semantic-revision-judge-config-store';
  import { enqueueSemanticRevisionJudge } from '../../src/queue/processors/semantic-revision-judge-job';
  import { Trial4TrainingCandidateStore } from '../../src/persona/trial4-training-candidate-store';
  import { Trial4BenchmarkCaseStore } from '../../src/persona/trial4-benchmark-case-store';
  import { Trial4BenchmarkResultStore } from '../../src/persona/trial4-benchmark-result-store';
  import {
    Trial4BenchmarkConfigStore,
    type Trial4BenchmarkConfig,
  } from '../../src/persona/trial4-benchmark-config-store';
  import { enqueueTrial4BenchmarkCase } from '../../src/queue/processors/trial4-benchmark-job';
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
  import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
  import type { Trial4BenchmarkLabel, Trial4BenchmarkResult, Trial4ResponseGrade } from '@spec/schema/trial4-benchmark-result';
  import type { JobPriority } from '@spec/protocol/job';
  import type { StorageClass } from '@spec/schema/storage-classes';
  import type { ExpressionSheet } from '@spec/schema/expression-sheet';
  import type { EditProfile } from '@spec/schema/edit-profile';
  import type { T2Profile } from '@spec/schema/t2-profile';
  import type { Pattern } from '@spec/schema/pattern';
  import type { TraitBeliefClaim } from '@spec/schema/trait-belief';
  import type { SemanticDeltaCandidate } from '@spec/schema/semantic-delta-candidate';
  import type { SemanticDeltaExtractionReceipt } from '@spec/schema/semantic-delta-extraction-receipt';
  import Status from '../../src/ui/Status.svelte';
  import Queue from '../../src/ui/Queue.svelte';
  import StorageUsage from '../../src/ui/StorageUsage.svelte';
  import Controls from '../../src/ui/Controls.svelte';
  import Onboarding from '../../src/ui/Onboarding.svelte';
  import ExpressionSheetSummary from '../../src/ui/ExpressionSheetSummary.svelte';
  import EditCapture from '../../src/ui/EditCapture.svelte';
  import EditProfileSummary from '../../src/ui/EditProfileSummary.svelte';
  import VectorIndex from '../../src/ui/VectorIndex.svelte';
  import T2ProfileSummary from '../../src/ui/T2ProfileSummary.svelte';
  import PatternsSummary from '../../src/ui/PatternsSummary.svelte';
  import TraitsBeliefsSummary from '../../src/ui/TraitsBeliefsSummary.svelte';
  import SemanticDeltaExtractionPanel from '../../src/ui/SemanticDeltaExtractionPanel.svelte';
  import Trial4TrainingReviewPanel from '../../src/ui/Trial4TrainingReviewPanel.svelte';
  import Trial4BenchmarkPanel from '../../src/ui/Trial4BenchmarkPanel.svelte';

  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  const controls = new RuntimeControls(storage);
  const sampleStore = new WritingSampleStore(storage);
  const expressionSheetStore = new ExpressionSheetStore(storage);
  const editEventStore = new EditEventStore(storage);
  const editProfileStore = new EditProfileStore(storage);
  const runtimeStatusStore = new RuntimeStatusStore(storage);
  const embeddingStore = new EmbeddingStore(storage);
  const embeddingProvider = new HashingEmbeddingProvider();
  // Query-time embedding is computed directly here (cheap, pure, read-only);
  // only writes to the index go through the job queue — see docs/decisions/0009.
  const vectorIndex = new VectorIndexService(embeddingProvider, embeddingStore, []);
  const t2ProfileStore = new T2ProfileStore(storage);
  const traitScoreStore = new TraitScoreStore(storage);
  const patternStore = new PatternStore(storage);
  const traitBeliefStore = new TraitBeliefStore(storage);
  const personaInterpreterConfigStore = new PersonaInterpreterConfigStore();
  const semanticDeltaCandidateStore = new SemanticDeltaCandidateStore(storage);
  const semanticDeltaExtractionReceiptStore = new SemanticDeltaExtractionReceiptStore(storage);
  const semanticDeltaExtractorConfigStore = new SemanticDeltaExtractorConfigStore();
  const semanticRevisionJudgeConfigStore = new SemanticRevisionJudgeConfigStore();
  const trial4TrainingCandidateStore = new Trial4TrainingCandidateStore(storage);
  const trial4BenchmarkCaseStore = new Trial4BenchmarkCaseStore(storage);
  const trial4BenchmarkResultStore = new Trial4BenchmarkResultStore(storage);
  const trial4BenchmarkConfigStore = new Trial4BenchmarkConfigStore();

  let counts: Record<JobPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let usage: Record<StorageClass, number> = { CANONICAL: 0, DERIVED: 0, CACHE: 0, RAW: 0 };
  let controlsState: RuntimeControlsState = { processingPaused: false, learningPaused: false };
  let sampleCount = 0;
  let expressionSheet: ExpressionSheet | undefined;
  let editProfile: EditProfile | undefined;
  let runtimeStatus: RuntimeStatus | undefined;
  let embeddingCount = 0;
  let searchResults: ScoredEmbedding[] = [];
  let t2Profile: T2Profile | undefined;
  let t2EvidenceCount = 0;
  let t2ClassifiedCount = 0;
  let patterns: Pattern[] = [];
  let traitBeliefs: TraitBeliefClaim[] = [];
  let personaInterpreterConfig: PersonaInterpreterConfig = { enabled: false };
  let semanticDeltaCandidates: SemanticDeltaCandidate[] = [];
  let semanticDeltaReceipts: SemanticDeltaExtractionReceipt[] = [];
  let semanticDeltaExtractorConfig: SemanticDeltaExtractorConfig = { enabled: false };
  let semanticRevisionJudgeConfig: SemanticRevisionJudgeConfig = { enabled: false };
  let trial4TrainingCandidates: Trial4TrainingCandidate[] = [];
  let trial4BenchmarkCases: Trial4BenchmarkCase[] = [];
  let trial4BenchmarkResults: Trial4BenchmarkResult[] = [];
  let trial4BenchmarkConfig: Trial4BenchmarkConfig = { enabled: false };
  // Same pure gate PersonaInterpreterService.interpret() itself checks
  // before ever calling the provider — computed here so the panel can show
  // *before* the user clicks "Interpret" whether this run will make any
  // network request at all, rather than that only being inferable after
  // the fact from an empty OpenRouter dashboard.
  $: personaInterpreterEligible = isEligibleForInterpretation(patterns, DEFAULT_PERSONA_INTERPRETER_POLICY);

  async function refresh() {
    counts = await queue.countsByPriority();
    usage = await storage.usageByClass();
    controlsState = await controls.get();
    sampleCount = (await sampleStore.list()).length;
    expressionSheet = await expressionSheetStore.get();
    editProfile = await editProfileStore.get();
    runtimeStatus = await runtimeStatusStore.get();
    embeddingCount = (await embeddingStore.list()).length;
    t2Profile = await t2ProfileStore.get();
    const [writingSamples, editEvents, traitScores] = await Promise.all([
      sampleStore.list(),
      editEventStore.list(),
      traitScoreStore.list(),
    ]);
    t2EvidenceCount = writingSamples.length + editEvents.length;
    t2ClassifiedCount = traitScores.filter((record) => Object.keys(record.scores).length > 0).length;
    patterns = await patternStore.list();
    traitBeliefs = await traitBeliefStore.list();
    personaInterpreterConfig = await personaInterpreterConfigStore.get();
    semanticDeltaCandidates = await semanticDeltaCandidateStore.list();
    semanticDeltaReceipts = await semanticDeltaExtractionReceiptStore.list();
    semanticDeltaExtractorConfig = await semanticDeltaExtractorConfigStore.get();
    semanticRevisionJudgeConfig = await semanticRevisionJudgeConfigStore.get();
    trial4TrainingCandidates = await trial4TrainingCandidateStore.list();
    trial4BenchmarkCases = await trial4BenchmarkCaseStore.list();
    trial4BenchmarkResults = await trial4BenchmarkResultStore.list();
    trial4BenchmarkConfig = await trial4BenchmarkConfigStore.get();
  }

  async function addSample(event: CustomEvent<string>) {
    const sample = await sampleStore.addSample(event.detail);
    const samples = await sampleStore.list();
    await expressionSheetStore.recompile(samples);
    await enqueueEmbeddingIndex(queue, 'writing_sample', sample.id, sample.text);
    await enqueueEvidenceClassification(queue, 'writing_sample', sample.id, sample.text);
    await refresh();
  }

  async function captureEdit(event: CustomEvent<{ sourceText: string; finalText: string }>) {
    // Persists + enqueues only; actual T0/T1 processing runs deferred in the
    // background dispatch loop, not here — see docs/decisions/0005.
    const captured = await captureEditEvent(queue, editEventStore, event.detail.sourceText, event.detail.finalText);
    await enqueueEmbeddingIndex(queue, 'edit_event', captured.id, captured.finalText);
    await enqueueEvidenceClassification(queue, 'edit_event', captured.id, captured.finalText);
    await refresh();
  }

  async function rebuildVectorIndex() {
    await enqueueVectorIndexRebuild(queue);
    await refresh();
  }

  async function rebuildT2Profile() {
    await enqueueT2ProfileRebuild(queue);
    await refresh();
  }

  async function searchVectors(event: CustomEvent<string>) {
    searchResults = await vectorIndex.query(event.detail, 5);
  }

  async function compilePatterns() {
    await enqueuePatternCompilation(queue);
    await refresh();
  }

  async function interpretTraitsBeliefs() {
    await enqueuePersonaInterpretation(queue);
    await refresh();
  }

  async function saveInterpreterConfig(event: CustomEvent<PersonaInterpreterConfig>) {
    await personaInterpreterConfigStore.set(event.detail);
    await refresh();
  }

  async function extractSemanticDeltas() {
    await enqueueSemanticDeltaExtraction(queue);
    await refresh();
  }

  async function judgeSemanticRevisions() {
    await enqueueSemanticRevisionJudge(queue);
    await refresh();
  }

  async function saveSemanticRevisionJudgeConfig(event: CustomEvent<SemanticRevisionJudgeConfig>) {
    await semanticRevisionJudgeConfigStore.set(event.detail);
    await refresh();
  }

  // --- Trial 4 (docs/decisions/0017) ---------------------------------
  // submitTrial4Judgment/revealTrial4Result intentionally duplicate
  // Trial4BenchmarkService's small grading/reveal logic rather than
  // instantiating that service here — the service exists to run model
  // calls (base/trained/DeepSeek), which only ever happens in the
  // background job (createTrial4BenchmarkProcessor), never from the
  // popup. Grading/reveal are pure local-storage mutations with no model
  // call involved, so a popup-local implementation avoids constructing
  // unused providers just to reach two methods.

  async function importTrial4Candidates(event: CustomEvent<Trial4TrainingCandidate[]>) {
    const existingIds = new Set(trial4TrainingCandidates.map((c) => c.id));
    const now = new Date().toISOString();
    for (const raw of event.detail) {
      if (!raw?.id || existingIds.has(raw.id)) continue;
      await trial4TrainingCandidateStore.put({ ...raw, decision: raw.decision ?? 'pending', importedAt: now });
    }
    await refresh();
  }

  async function decideTrial4Candidate(event: CustomEvent<{ id: string; decision: 'accepted' | 'rejected' }>) {
    const candidate = await trial4TrainingCandidateStore.get(event.detail.id);
    if (!candidate) return;
    await trial4TrainingCandidateStore.put({
      ...candidate,
      decision: event.detail.decision,
      reviewedAt: new Date().toISOString(),
    });
    await refresh();
  }

  async function importTrial4BenchmarkCases(event: CustomEvent<Trial4BenchmarkCase[]>) {
    const existingIds = new Set(trial4BenchmarkCases.map((c) => c.id));
    for (const raw of event.detail) {
      if (!raw?.id || existingIds.has(raw.id)) continue;
      await trial4BenchmarkCaseStore.put(raw);
    }
    await refresh();
  }

  async function runTrial4BenchmarkCase() {
    await enqueueTrial4BenchmarkCase(queue);
    await refresh();
  }

  async function submitTrial4Judgment(
    event: CustomEvent<{
      resultId: string;
      grades: Record<Trial4BenchmarkLabel, Trial4ResponseGrade>;
      bestResponse: Trial4BenchmarkResult['bestResponse'];
      note: string;
    }>,
  ) {
    const result = await trial4BenchmarkResultStore.get(event.detail.resultId);
    if (!result || result.judged) return;
    const { grades, bestResponse, note } = event.detail;
    const updated: Trial4BenchmarkResult = {
      ...result,
      labelMapping: {
        A: { ...result.labelMapping.A, grade: grades.A },
        B: { ...result.labelMapping.B, grade: grades.B },
        C: { ...result.labelMapping.C, grade: grades.C },
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
    if (!result) return;
    await trial4BenchmarkResultStore.put({ ...result, revealed: true });
    await refresh();
  }

  async function saveTrial4BenchmarkConfig(event: CustomEvent<Trial4BenchmarkConfig>) {
    await trial4BenchmarkConfigStore.set(event.detail);
    await refresh();
  }

  async function saveSemanticDeltaExtractorConfig(event: CustomEvent<SemanticDeltaExtractorConfig>) {
    await semanticDeltaExtractorConfigStore.set(event.detail);
    await refresh();
  }

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
    // Signals the background dispatch loop that a foreground surface is
    // open; disconnects automatically when the popup closes.
    foregroundPort = chrome.runtime.connect({ name: FOREGROUND_PORT_NAME });
    refresh();
    interval = setInterval(refresh, 2000);
  });
  onDestroy(() => {
    clearInterval(interval);
    foregroundPort?.disconnect();
  });
</script>

<main>
  <h1>HDNA</h1>
  <Status
    mode={runtimeStatus?.mode}
    processingPaused={controlsState.processingPaused}
    learningPaused={controlsState.learningPaused}
  />
  <Onboarding {sampleCount} on:addSample={addSample} />
  <ExpressionSheetSummary sheet={expressionSheet} />
  <EditCapture on:capture={captureEdit} />
  <EditProfileSummary profile={editProfile} />
  <T2ProfileSummary
    profile={t2Profile}
    evidenceCount={t2EvidenceCount}
    classifiedCount={t2ClassifiedCount}
    on:rebuild={rebuildT2Profile}
  />
  <PatternsSummary {patterns} on:compile={compilePatterns} />
  <TraitsBeliefsSummary
    claims={traitBeliefs}
    patternCount={patterns.length}
    minPatternCount={DEFAULT_PERSONA_INTERPRETER_POLICY.minPatternCount}
    eligible={personaInterpreterEligible}
    config={personaInterpreterConfig}
    on:interpret={interpretTraitsBeliefs}
    on:saveConfig={saveInterpreterConfig}
  />
  <SemanticDeltaExtractionPanel
    candidates={semanticDeltaCandidates}
    receipts={semanticDeltaReceipts}
    config={semanticDeltaExtractorConfig}
    judgeConfig={semanticRevisionJudgeConfig}
    on:extract={extractSemanticDeltas}
    on:judgeRevisions={judgeSemanticRevisions}
    on:saveConfig={saveSemanticDeltaExtractorConfig}
    on:saveJudgeConfig={saveSemanticRevisionJudgeConfig}
  />
  <Trial4TrainingReviewPanel
    candidates={trial4TrainingCandidates}
    on:importCandidates={importTrial4Candidates}
    on:decide={decideTrial4Candidate}
  />
  <Trial4BenchmarkPanel
    cases={trial4BenchmarkCases}
    results={trial4BenchmarkResults}
    config={trial4BenchmarkConfig}
    on:importCases={importTrial4BenchmarkCases}
    on:runNextCase={runTrial4BenchmarkCase}
    on:submitJudgment={submitTrial4Judgment}
    on:reveal={revealTrial4Result}
    on:saveConfig={saveTrial4BenchmarkConfig}
  />
  <VectorIndex
    {embeddingCount}
    extractorId={embeddingProvider.extractorId}
    extractorVersion={embeddingProvider.extractorVersion}
    results={searchResults}
    on:rebuild={rebuildVectorIndex}
    on:search={searchVectors}
  />
  <Queue {counts} />
  <StorageUsage
    {usage}
    lastEvictionAt={runtimeStatus?.lastEvictionAt}
    lastEvictionBytesFreed={runtimeStatus?.lastEvictionBytesFreed}
  />
  <Controls
    processingPaused={controlsState.processingPaused}
    learningPaused={controlsState.learningPaused}
    on:toggleProcessing={toggleProcessing}
    on:toggleLearning={toggleLearning}
  />
</main>

<style>
  main {
    width: 280px;
    padding: 12px;
    font-family: system-ui, sans-serif;
  }
  h1 {
    font-size: 16px;
    margin: 0 0 8px;
  }
</style>
