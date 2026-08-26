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
  protocol/
    job.ts                        - Job/JobPriority(P0-P3)/JobStatus queue protocol
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
    storage/
      types.ts                    - StorageAdapter interface incl. putMany (atomic multi-key write)
      indexeddb-adapter.ts        - IndexedDB-backed StorageAdapter (see docs/decisions/0001, 0007)
    queue/
      job-queue.ts                - at-least-once persistent priority queue; stale-RUNNING lease reclaim (see docs/decisions/0007)
      processors/noop-processor.ts - synthetic processor for pipeline tests only
      processors/edit-event-processor.ts - P1: idempotent EditMetrics compute + atomic EditProfile fold-in (see docs/decisions/0007)
    governor/
      types.ts                    - RuntimeMode, GovernorSignals (some fields SPEC_RESERVED/unwired)
      resource-governor.ts        - pure decide(signals, prevBatchSize) -> {mode, nextBatchSize}
    runtime/
      controls.ts                 - RuntimeControls: pause processing vs pause learning (persisted)
    ui/
      Status.svelte, Queue.svelte, StorageUsage.svelte, Controls.svelte,
      Onboarding.svelte, ExpressionSheetSummary.svelte,
      EditCapture.svelte, EditProfileSummary.svelte
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
