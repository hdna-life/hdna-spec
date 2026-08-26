import { IndexedDbStorageAdapter } from '../src/storage/indexeddb-adapter';
import { JobQueue } from '../src/queue/job-queue';
import { noopProcessor } from '../src/queue/processors/noop-processor';
import { PROCESS_EDIT_EVENT_JOB, createEditEventProcessor } from '../src/queue/processors/edit-event-processor';
import { RuntimeControls } from '../src/runtime/controls';
import { RuntimeStatusStore } from '../src/runtime/status';
import { ForegroundTracker } from '../src/runtime/foreground-tracker';
import { computeForegroundInactivity } from '../src/runtime/foreground-inactivity';
import { EditEventStore } from '../src/persona/edit-event-store';
import { EditMetricsStore } from '../src/persona/edit-metrics-store';
import { EditProfileStore } from '../src/persona/edit-profile-store';
import { WritingSampleStore } from '../src/persona/sample-store';
import { EmbeddingStore } from '../src/persona/embedding-store';
import { HashingEmbeddingProvider } from '../src/persona/hashing-embedding-provider';
import { VectorIndexService } from '../src/persona/vector-index-service';
import { editEventSource, writingSampleSource } from '../src/persona/embedding-sources';
import {
  INDEX_EMBEDDING_JOB,
  REBUILD_VECTOR_INDEX_JOB,
  createIndexEmbeddingProcessor,
  createRebuildVectorIndexProcessor,
} from '../src/queue/processors/embedding-jobs';
import { TraitScoreStore } from '../src/persona/trait-score-store';
import { T2ProfileStore } from '../src/persona/t2-profile-store';
import { TraitClassifierService } from '../src/persona/trait-classifier-service';
import { HeuristicTinyClassifier } from '../src/persona/t2-classifier';
import {
  CLASSIFY_EVIDENCE_JOB,
  REBUILD_T2_PROFILE_JOB,
  createClassifyEvidenceProcessor,
  createRebuildT2ProfileProcessor,
} from '../src/queue/processors/trait-classification-jobs';
import { PatternStore } from '../src/persona/pattern-store';
import { PatternCompilerService } from '../src/persona/pattern-compiler-service';
import {
  COMPILE_PATTERNS_JOB,
  createCompilePatternsProcessor,
} from '../src/queue/processors/pattern-compilation-job';
import { TraitBeliefStore } from '../src/persona/trait-belief-store';
import { PersonaInterpreterConfigStore } from '../src/persona/persona-interpreter-config-store';
import { OpenRouterPersonaInterpreter } from '../src/persona/openrouter-persona-interpreter';
import { PersonaInterpreterService } from '../src/persona/persona-interpreter-service';
import {
  INTERPRET_TRAITS_BELIEFS_JOB,
  createInterpretTraitsBeliefsProcessor,
} from '../src/queue/processors/persona-interpretation-job';
import { SemanticDeltaCandidateStore } from '../src/persona/semantic-delta-candidate-store';
import { SemanticDeltaExtractionReceiptStore } from '../src/persona/semantic-delta-extraction-receipt-store';
import { SemanticDeltaExtractorConfigStore } from '../src/persona/semantic-delta-extractor-config-store';
import { OpenRouterSemanticDeltaExtractor } from '../src/persona/openrouter-semantic-delta-extractor';
import { SemanticDeltaExtractionService } from '../src/persona/semantic-delta-extraction-service';
import {
  EXTRACT_SEMANTIC_DELTAS_JOB,
  createExtractSemanticDeltasProcessor,
} from '../src/queue/processors/semantic-delta-extraction-job';
import { decide, decideMode } from '../src/governor/resource-governor';
import { ALLOWED_PRIORITIES_BY_MODE } from '../src/governor/mode-priorities';
import type { GovernorSignals } from '../src/governor/types';
import { evictIfNeeded } from '../src/storage/eviction';
import { DEFAULT_STORAGE_POLICY } from '@spec/schema/storage-policy';

const DISPATCH_ALARM = 'hdna-dispatch';
const EXPECTED_JOB_LATENCY_MS = 50;

export default defineBackground(() => {
  const storage = new IndexedDbStorageAdapter();
  const queue = new JobQueue(storage);
  queue.registerProcessor('noop', noopProcessor);
  const editEventStore = new EditEventStore(storage);
  const editMetricsStore = new EditMetricsStore(storage);
  queue.registerProcessor(
    PROCESS_EDIT_EVENT_JOB,
    createEditEventProcessor(storage, editEventStore, editMetricsStore, new EditProfileStore(storage)),
  );

  const sampleStore = new WritingSampleStore(storage);
  const vectorIndex = new VectorIndexService(new HashingEmbeddingProvider(), new EmbeddingStore(storage), [
    writingSampleSource(sampleStore),
    editEventSource(editEventStore),
  ]);
  queue.registerProcessor(INDEX_EMBEDDING_JOB, createIndexEmbeddingProcessor(vectorIndex));
  queue.registerProcessor(REBUILD_VECTOR_INDEX_JOB, createRebuildVectorIndexProcessor(vectorIndex));

  const traitScoreStore = new TraitScoreStore(storage);
  const traitClassifier = new TraitClassifierService(
    storage,
    new HeuristicTinyClassifier(),
    traitScoreStore,
    new T2ProfileStore(storage),
    [writingSampleSource(sampleStore), editEventSource(editEventStore)],
  );
  queue.registerProcessor(CLASSIFY_EVIDENCE_JOB, createClassifyEvidenceProcessor(traitClassifier));
  queue.registerProcessor(REBUILD_T2_PROFILE_JOB, createRebuildT2ProfileProcessor(traitClassifier));

  const patternCompiler = new PatternCompilerService(
    editMetricsStore,
    editEventStore,
    traitScoreStore,
    sampleStore,
    new PatternStore(storage),
  );
  queue.registerProcessor(COMPILE_PATTERNS_JOB, createCompilePatternsProcessor(patternCompiler));

  const personaInterpreter = new PersonaInterpreterService(
    (apiKey, modelId) => new OpenRouterPersonaInterpreter(apiKey, modelId),
    new PatternStore(storage),
    new TraitBeliefStore(storage),
    new PersonaInterpreterConfigStore(),
  );
  queue.registerProcessor(INTERPRET_TRAITS_BELIEFS_JOB, createInterpretTraitsBeliefsProcessor(personaInterpreter));

  const semanticDeltaExtraction = new SemanticDeltaExtractionService(
    storage,
    (apiKey, modelId) => new OpenRouterSemanticDeltaExtractor(apiKey, modelId),
    editEventStore,
    new SemanticDeltaCandidateStore(storage),
    new SemanticDeltaExtractionReceiptStore(storage),
    new SemanticDeltaExtractorConfigStore(),
  );
  queue.registerProcessor(EXTRACT_SEMANTIC_DELTAS_JOB, createExtractSemanticDeltasProcessor(semanticDeltaExtraction));

  const controls = new RuntimeControls(storage);
  const runtimeStatus = new RuntimeStatusStore(storage);
  const foregroundTracker = new ForegroundTracker();
  chrome.runtime.onConnect.addListener((port) => foregroundTracker.handleConnect(port));

  // Batch size is the only thing still carried in service-worker memory
  // across ticks — a restart resetting it to this safe default is a minor,
  // self-correcting adaptation blip, not a correctness bug (unlike mode/
  // idleness, which used to be carried the same way — see
  // docs/decisions/0014 for why that was wrong).
  let batchSize = 4;

  chrome.alarms.create(DISPATCH_ALARM, { periodInMinutes: 0.5 });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== DISPATCH_ALARM) return;

    const state = await controls.get();
    if (state.processingPaused) return;

    const counts = await queue.countsByPriority();
    const totalBacklog = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalBacklog === 0) return;

    // Mode for THIS tick's dispatch is computed fresh from a *persisted*
    // inactivity timestamp plus the current foreground signal — never from
    // an in-memory value carried from the previous tick, which resets on
    // every MV3 service-worker restart and previously made DEEP_IDLE
    // unreachable whenever the worker didn't survive between dispatch
    // alarms. See docs/decisions/0014.
    const previousStatus = await runtimeStatus.get();
    const foregroundActive = foregroundTracker.isActive;
    const { foregroundInactiveSince, inactiveDurationMs } = computeForegroundInactivity(
      previousStatus?.foregroundInactiveSince,
      foregroundActive,
      Date.now(),
    );
    const mode = decideMode(foregroundActive, inactiveDurationMs);

    // Only priorities the current mode allows are dispatched; the rest stay
    // PENDING and are picked up once the mode relaxes (e.g. foreground goes
    // idle for long enough to reach DEEP_IDLE). Mode is driven purely by
    // foreground activity/idleness, never by backlog — see
    // docs/decisions/0013 for why gating on an empty queue was a bug.
    const allowedPriorities = ALLOWED_PRIORITIES_BY_MODE[mode];
    const start = performance.now();
    let ran = 0;
    while (ran < batchSize) {
      const job = await queue.runNext(allowedPriorities);
      if (!job) break;
      ran += 1;
    }
    const elapsed = performance.now() - start;

    const signals: GovernorSignals = {
      queueBacklog: Math.max(0, totalBacklog - ran),
      // A neutral (ratio-1) reading when nothing ran this tick — e.g. every
      // pending job was outside the allowed priorities — so batch size
      // doesn't drift on a measurement that never happened.
      lastJobLatencyMs: ran > 0 ? elapsed / ran : EXPECTED_JOB_LATENCY_MS,
      expectedJobLatencyMs: EXPECTED_JOB_LATENCY_MS,
      foregroundActive,
      foregroundInactiveDurationMs: inactiveDurationMs,
    };
    // decision.mode is always decideMode(foregroundActive, inactiveDurationMs)
    // again — the same value as `mode` above, since neither signal changed
    // mid-tick. Only the batch-size half of the decision is new here.
    const decision = decide(signals, batchSize);
    batchSize = decision.nextBatchSize;

    // Eviction is deferred while the user is actively interacting —
    // "Foreground interaction always wins."
    let lastEviction: { at: string; bytesFreed: number } | undefined;
    if (mode !== 'INTERACTIVE') {
      const plan = await evictIfNeeded(storage, DEFAULT_STORAGE_POLICY);
      if (plan.bytesFreed > 0) lastEviction = { at: new Date().toISOString(), bytesFreed: plan.bytesFreed };
    }

    await runtimeStatus.set({
      mode,
      batchSize,
      updatedAt: new Date().toISOString(),
      lastEvictionAt: lastEviction?.at ?? previousStatus?.lastEvictionAt,
      lastEvictionBytesFreed: lastEviction?.bytesFreed ?? previousStatus?.lastEvictionBytesFreed,
      foregroundInactiveSince,
    });
  });
});
