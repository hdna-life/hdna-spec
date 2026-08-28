import { IndexedDbStorageAdapter } from '../src/storage/indexeddb-adapter';
import { JobQueue } from '../src/queue/job-queue';
import { noopProcessor } from '../src/queue/processors/noop-processor';
import { PROCESS_EDIT_EVENT_JOB, createEditEventProcessor } from '../src/queue/processors/edit-event-processor';
import { RuntimeControls } from '../src/runtime/controls';
import { RuntimeStatusStore } from '../src/runtime/status';
import { ForegroundTracker } from '../src/runtime/foreground-tracker';
import { computeForegroundInactivity } from '../src/runtime/foreground-inactivity';
import { DISPATCH_TRIGGER_MESSAGE_TYPE } from '../src/runtime/dispatch-trigger';
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
import { LocalMlxSemanticRevisionJudge } from '../src/persona/local-mlx-semantic-revision-judge';
import { SemanticRevisionJudgeConfigStore } from '../src/persona/semantic-revision-judge-config-store';
import { SemanticRevisionJudgeExtractionService } from '../src/persona/semantic-revision-judge-extraction-service';
import {
  JUDGE_SEMANTIC_REVISIONS_JOB,
  createJudgeSemanticRevisionsProcessor,
} from '../src/queue/processors/semantic-revision-judge-job';
import { Trial4BenchmarkCaseStore } from '../src/persona/trial4-benchmark-case-store';
import { Trial4BenchmarkResultStore } from '../src/persona/trial4-benchmark-result-store';
import { Trial4BenchmarkConfigStore } from '../src/persona/trial4-benchmark-config-store';
import { OpenRouterSemanticRevisionJudge } from '../src/persona/openrouter-semantic-revision-judge';
import { Trial4BenchmarkService } from '../src/persona/trial4-benchmark-service';
import {
  RUN_TRIAL4_BENCHMARK_CASE_JOB,
  createTrial4BenchmarkProcessor,
} from '../src/queue/processors/trial4-benchmark-job';
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

  // Trial 3 (docs/decisions/0016's Trial 3 section) — a structurally
  // separate service from semanticDeltaExtraction above, not a
  // replacement for it. Real transport is now a local MLX-LM server
  // (docs/decisions/0016's Trial 3 "local MLX transport" addendum), not
  // OpenRouter: SemanticRevisionJudgeConfigStore holds baseUrl/modelId
  // only — no API key, no cloud request. The operator points baseUrl at
  // their running `mlx_lm.server` instance (default
  // http://127.0.0.1:8080) and modelId at `Qwen/Qwen3-0.6B` in the popup
  // before running this job. There is no fallback to OpenRouter or any
  // stronger/different model anywhere in this wiring.
  const semanticRevisionJudge = new SemanticRevisionJudgeExtractionService(
    storage,
    (baseUrl, modelId) => new LocalMlxSemanticRevisionJudge(baseUrl, modelId),
    editEventStore,
    new SemanticDeltaCandidateStore(storage),
    new SemanticDeltaExtractionReceiptStore(storage),
    new SemanticRevisionJudgeConfigStore(),
  );
  queue.registerProcessor(
    JUDGE_SEMANTIC_REVISIONS_JOB,
    createJudgeSemanticRevisionsProcessor(semanticRevisionJudge),
  );

  // Trial 4 (docs/decisions/0017) — human-filtered specialization +
  // blind benchmark. This service does NOT do training-data generation
  // or LoRA training itself (those are external, `training/phase5a/`
  // Python scripts, per Operator Decision 8's scope-control rule) — it
  // only orchestrates the blind three-way comparison: base Qwen3-0.6B and
  // trained Qwen3-0.6B are both `LocalMlxSemanticRevisionJudge` instances
  // (the same provider class, pointed at two different local MLX-LM
  // server ports — one serving the base model, one serving it with
  // `--adapter-path` loaded), and DeepSeek is the frontier reference
  // reached via OpenRouter — NOT DeepSeek's own direct API (Test 1
  // evaluation-stage addendum) — using the same `OpenRouterSemanticRevisionJudge`
  // class Trial 3's OpenRouter transport already uses, reused as-is rather
  // than a second networking implementation. Providers are constructed
  // fresh from `Trial4BenchmarkConfigStore` on every run — never a stale
  // endpoint/key.
  const trial4Benchmark = new Trial4BenchmarkService(
    (config) => ({
      base: new LocalMlxSemanticRevisionJudge(config.baseModelUrl!, config.localModelId!),
      trained: new LocalMlxSemanticRevisionJudge(config.trainedModelUrl!, config.localModelId!),
      deepseek: new OpenRouterSemanticRevisionJudge(config.openRouterApiKey!, config.deepSeekModelId!),
    }),
    new Trial4BenchmarkCaseStore(storage),
    new Trial4BenchmarkResultStore(storage),
    new Trial4BenchmarkConfigStore(),
  );
  queue.registerProcessor(RUN_TRIAL4_BENCHMARK_CASE_JOB, createTrial4BenchmarkProcessor(trial4Benchmark));

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

  // Extracted so both the periodic alarm AND an explicit
  // DISPATCH_TRIGGER_MESSAGE_TYPE message (sent by a foreground surface
  // right after enqueueing a job it wants to see start immediately — e.g.
  // Trial 4's "Run next case" button) run the exact same tick. Nothing
  // about the governor's mode/priority gating or the processing-paused
  // control changes; a message trigger only removes the up-to-30s wait for
  // the next scheduled alarm, it does not bypass any safety check below.
  async function dispatchTick(): Promise<void> {
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
  }

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== DISPATCH_ALARM) return;
    await dispatchTick();
  });

  // Fires an immediate dispatchTick() on request — see DISPATCH_TRIGGER_MESSAGE_TYPE's
  // docstring. `sendResponse` is called once the tick completes (success or
  // error) purely so the sender's `chrome.runtime.sendMessage` promise
  // resolves instead of timing out; the caller does not need to act on the
  // response. Returning `true` keeps the message channel open for that
  // async `sendResponse` (required by the extension messaging API).
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if ((message as { type?: unknown })?.type !== DISPATCH_TRIGGER_MESSAGE_TYPE) return undefined;
    dispatchTick()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  });
});
