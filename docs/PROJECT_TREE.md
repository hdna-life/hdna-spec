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
    storage/
      types.ts                    - StorageAdapter interface
      indexeddb-adapter.ts        - IndexedDB-backed StorageAdapter (see docs/decisions/0001)
    queue/
      job-queue.ts                - persistent priority queue over StorageAdapter
      processors/noop-processor.ts - synthetic processor for pipeline tests only
    governor/
      types.ts                    - RuntimeMode, GovernorSignals (some fields SPEC_RESERVED/unwired)
      resource-governor.ts        - pure decide(signals, prevBatchSize) -> {mode, nextBatchSize}
    runtime/
      controls.ts                 - RuntimeControls: pause processing vs pause learning (persisted)
    ui/
      Status.svelte, Queue.svelte, StorageUsage.svelte, Controls.svelte
  tests/                          - vitest, mirrors src/ structure, fake-indexeddb for storage tests

docs/
  PROJECT_TREE.md                 - this file
  CURRENT_STATE.md                - active phase/scope/gaps
  decisions/                      - decision log (Decision/Why/Alternatives/Evidence/Validation)
  architecture/mvp-scope.md       - MVP_REQUIRED vs SPEC_RESERVED/PLANNED/EXPERIMENTAL for this PR
  research/references.md          - condensed academic reference notebook

hdna-design-research-document.md  - source-of-truth design/research doc (unmoved, repo root)
```

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
