# PROJECT_TREE.md

Last reviewed commit: (initial commit — this PR)

Concise module map. Read this before rereading the repository.

```text
spec/                             - protocol/schema types only, no runtime logic
  schema/
    storage-classes.ts            - StorageClass, deletion-priority order
    evidence.ts                   - provenance/confidence/privacy metadata shape
    identity.ts                   - typed IdentityFact placeholder shape
    expression-sheet.ts           - Expression Sheet interface, MVP_REQUIRED/SPEC_RESERVED tagged fields
    writing-sample.ts             - onboarding writing sample shape (canonical evidence)
    edit-event.ts                 - AI-output/human-edit pair shape (canonical evidence)
    edit-metrics.ts                - per-event T0 diff metrics shape (derived)
    edit-profile.ts                - running T1 aggregate profile shape (derived)
    storage-policy.ts              - StoragePolicy (total-byte budget), DEFAULT_STORAGE_POLICY
    embedding.ts                    - Embedding/EmbeddingVector shape (derived, rebuildable)
    t2-dimensions.ts                - T2Dimension union + T2_DIMENSION_STATUS (formality/directness MVP_REQUIRED, 5 others SPEC_RESERVED)
    trait-score.ts                  - TraitScoreRecord: per-evidence classifier output (derived)
    t2-profile.ts                   - T2DimensionAggregate/T2Profile: confidence-weighted running aggregate (derived)
  protocol/
    job.ts                        - Job/JobPriority(P0-P3)/JobStatus queue protocol
    embedding-provider.ts          - EmbeddingProvider interface, execution-context-agnostic (see docs/decisions/0009)
    tiny-classifier.ts              - TinyClassifier interface, execution-context-agnostic (see docs/decisions/0010)
  hdna-format/
    manifest.ts                   - `.hdna` package manifest shape (typing only)

extension/                        - MV3 + Svelte runtime (WXT-built)
  wxt.config.ts                   - manifest permissions (storage, alarms), @spec alias
  entrypoints/
    background.ts                 - SW: chrome.alarms dispatch loop, wires queue+governor+controls
    popup/
      App.svelte                  - mounts ui/ components, polls queue/storage/controls state
      main.ts, index.html
  src/
    persona/
      stylometry.ts                - pure T0 deterministic extractors (sentence/word split, punctuation, emoji, casing)
      expression-sheet-compiler.ts - compileExpressionSheet(samples) -> ExpressionSheet, MVP_REQUIRED fields only
      sample-store.ts              - WritingSampleStore: persists onboarding samples (CANONICAL)
      expression-sheet-store.ts    - ExpressionSheetStore: persists compiled sheet (DERIVED), see docs/decisions/0004
      edit-metrics.ts              - pure T0 diff extractors: levenshteinDistance, jaccardWordOverlap, computeEditMetrics
      edit-profile.ts              - applyEditMetrics: T1 incremental mean update, no history rescan
      edit-event-store.ts          - EditEventStore: persists AI-output/human-edit pairs (CANONICAL)
      edit-metrics-store.ts        - EditMetricsStore: persists per-event T0 diff metrics (DERIVED)
      edit-profile-store.ts        - EditProfileStore: persists running T1 aggregate (DERIVED)
      capture.ts                   - captureEditEvent: persist + enqueue P1 job, returns immediately (see docs/decisions/0005)
      hashing-embedding-provider.ts - HashingEmbeddingProvider: deterministic n-gram hashing baseline (see docs/decisions/0009)
      vector-index.ts              - cosineSimilarity + queryNearest: pure retrieval primitives
      embedding-store.ts           - EmbeddingStore: persists Embedding records (DERIVED)
      embedding-sources.ts         - writingSampleSource/editEventSource: canonical evidence -> {id,text} for indexing
      vector-index-service.ts      - VectorIndexService: indexOne/rebuild()/query(), the rebuildable-index contract
      t2-classifier.ts              - HeuristicTinyClassifier: deterministic formality/directness heuristics, English-only gated via isLikelyEnglish (see docs/decisions/0010, 0012)
      t2-profile.ts                 - applyTraitScore: confidence-weighted T1-style incremental aggregation
      trait-score-store.ts          - TraitScoreStore: persists per-evidence TraitScoreRecord (DERIVED)
      t2-profile-store.ts           - T2ProfileStore: persists T2Profile aggregate (DERIVED)
      trait-classifier-service.ts   - TraitClassifierService: classifyOne (idempotent)/rebuild(), same pattern as VectorIndexService
    storage/
      types.ts                    - StorageAdapter interface incl. putMany (atomic write), listRecordMeta
      indexeddb-adapter.ts        - IndexedDB-backed StorageAdapter (see docs/decisions/0001, 0007)
      eviction.ts                 - planEviction (pure) + evictIfNeeded: CACHE->DERIVED->RAW, CANONICAL never auto (see docs/decisions/0008)
    queue/
      job-queue.ts                - at-least-once persistent priority queue; stale-RUNNING lease reclaim; priority-filtered next()/runNext() (see docs/decisions/0007, 0008)
      processors/noop-processor.ts - synthetic processor for pipeline tests only
      processors/edit-event-processor.ts - P1: idempotent EditMetrics compute + atomic EditProfile fold-in (see docs/decisions/0007)
      processors/embedding-jobs.ts - P2 index_embedding (incremental) / P3 rebuild_vector_index (see docs/decisions/0009)
      processors/trait-classification-jobs.ts - P2 classify_evidence (incremental) / P3 rebuild_t2_profile (see docs/decisions/0010)
    governor/
      types.ts                    - RuntimeMode, GovernorSignals (some fields SPEC_RESERVED/unwired)
      resource-governor.ts        - pure decide(signals, prevBatchSize) -> {mode, nextBatchSize}
      mode-priorities.ts          - ALLOWED_PRIORITIES_BY_MODE: which job priorities each mode may dispatch (see docs/decisions/0008)
    runtime/
      controls.ts                 - RuntimeControls: pause processing vs pause learning (persisted)
      foreground-tracker.ts       - ForegroundTracker: is the popup open, via chrome.runtime.Port (see docs/decisions/0008)
      status.ts                   - RuntimeStatusStore: persists background loop's live mode/batchSize/eviction state for the popup
    ui/
      Status.svelte, Queue.svelte, StorageUsage.svelte, Controls.svelte,
      Onboarding.svelte, ExpressionSheetSummary.svelte,
      EditCapture.svelte, EditProfileSummary.svelte, VectorIndex.svelte,
      T2ProfileSummary.svelte
  tests/                          - vitest, mirrors src/ structure, fake-indexeddb for storage tests

docs/
  PROJECT_TREE.md                 - this file
  CURRENT_STATE.md                - active phase/scope/gaps
  decisions/                      - decision log (Decision/Why/Alternatives/Evidence/Validation)
  architecture/mvp-scope.md       - MVP_REQUIRED vs SPEC_RESERVED/PLANNED/EXPERIMENTAL for this PR
  research/references.md          - condensed academic reference notebook

```

The source design/research document is kept local-only (gitignored), not
committed to this repository — see `docs/decisions/` for why.

## Files commonly affected together

- Adding a job type: `spec/protocol/job.ts` (if the protocol shape changes) +
  `extension/src/queue/processors/<name>.ts` + registration in
  `entrypoints/background.ts` + a test in `extension/tests/queue/`.
- Adding a storage-backed field: the relevant `spec/schema/*.ts` type +
  `extension/src/storage/indexeddb-adapter.ts` callers + a test in
  `extension/tests/storage/`.
- Changing governor behavior: `extension/src/governor/resource-governor.ts` +
  `extension/src/governor/types.ts` + `extension/tests/governor/` +
  `entrypoints/background.ts` (batch-size wiring).
