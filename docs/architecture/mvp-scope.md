# MVP Scope Classification — Foundation PR

Restates this PR's scope per `hdna-design-research-document.md`'s "MVP Scope
and Deferred Architecture Rule", so future agents don't need to re-read the
full source document to know what's in/out of scope for the codebase as it
stands after this PR.

## MVP_REQUIRED — implemented in this PR

- MV3 extension runtime (WXT + Svelte), background service worker + popup.
- Local storage abstraction (`StorageAdapter`, IndexedDB-backed).
- Persistent job queue (P0-P3 priority classes, survives SW termination).
- Resource governor skeleton (pure, latency/backlog-driven decisions).
- Runtime controls (pause processing vs. pause learning, persisted, distinct).
- Transparency UI (status, queue, storage usage, controls).
- Deterministic test infrastructure (vitest + fake-indexeddb).
- `spec/` protocol/schema type definitions: storage classes, evidence
  metadata, identity facts, Expression Sheet shape, writing sample shape,
  `.hdna` manifest shape.
- Phase 1 cold-start onboarding: `WritingSampleStore` (real samples, CANONICAL)
  + deterministic T0 stylometry extractors (`stylometry.ts`) +
  `compileExpressionSheet()` -> `ExpressionSheetStore` (DERIVED, rebuildable).
  Populates only the Expression Sheet's MVP_REQUIRED fields.
- Phase 2 first slice — AI-output/human-edit pairs as passive-learning
  evidence, captured manually (`docs/decisions/0005`), processed via the P1
  job queue: `EditEventStore` (CANONICAL) -> `computeEditMetrics()` (pure T0
  diff: Levenshtein distance, compression ratio, sentence-count change,
  Jaccard lexical overlap) -> `EditMetricsStore` (DERIVED) ->
  `applyEditMetrics()` (T1 incremental mean, no history rescan) ->
  `EditProfileStore` (DERIVED).
- Phase 3A — batching/scheduling and storage-eviction infrastructure
  (`docs/decisions/0008`): `JobQueue` dispatch is mode-gated via
  `ALLOWED_PRIORITIES_BY_MODE`; `foregroundActive` is a real signal
  (`ForegroundTracker`, popup-open detection via `chrome.runtime.Port`,
  replacing the previous hardcoded `false`); `planEviction()`/`evictIfNeeded()`
  actually run (CACHE→DERIVED→RAW, CANONICAL never automatic), deferred while
  `mode === 'INTERACTIVE'`.

## SPEC_RESERVED — typed, not implemented

- `GovernorSignals.webgpuContention` / `.batteryLevel` / `.memoryPressure` —
  fields exist on the type so the governor's function signature is stable,
  but nothing produces these signals and the governor's `decide()` logic does
  not read them.
- `ExpressionSheet.prosody`, `.gestureProfile`, `.formality`, `.directness`,
  `.warmth` — fields exist per the doc's canonical layers, explicitly tagged
  `SPEC_RESERVED` in `EXPRESSION_SHEET_FIELD_STATUS`, never populated.
- `.hdna` manifest shape (`spec/hdna-format/manifest.ts`) — typing only, no
  compiler/export pipeline.

## PLANNED — not started

- Phase 2 passive evidence capture at scale: content-script-based *live*
  capture of AI-output/human-edit pairs across web pages (this slice is
  manual-only, see `docs/decisions/0005`), character n-grams, typo-pattern
  detection, response latency, keystroke/session aggregation, full context
  metadata taxonomy (writing.public_social / writing.private_message / etc.).
- Phase 3B — local embeddings + vector index: one model/library decision,
  benchmark, and retrieval primitives, its own future PR.
- Phase 3C — tiny local classifiers (T2: formality/directness/warmth/etc.),
  its own future PR.
- Phase 4 persona compiler (events -> patterns -> traits/beliefs).
- Phase 5 retrieval runtime (query-focused persona assembly).
- Phase 6 WebGPU expression engine (the actual style-transform model).
- Phase 7 optional local neural adaptation (LoRA/adapters).
- Phase 8 multimodal activation (speech/visual/gesture).
- Phase 9 export/publish/self-host runtime.

## EXPERIMENTAL — not started, research-only

- Small (~sub-billion-parameter) persona expression model hypothesis
  (TinyStyler-adjacent) — requires semantic-preservation, persona-similarity,
  multilingual, and WebGPU-performance benchmarks before any implementation.

## What remains out of scope after this round

This PR makes the governor's mode output and foreground signal real (both
were previously computed/hardcoded but unused), and makes storage eviction
actually run for the first time. It still does not implement: live/
content-script capture, character n-grams or other T0 signals beyond diffing,
T2 tiny classifiers, embeddings, a vector index, the WebGPU expression
transformation itself, wiring EditProfile into the Expression Sheet, user-
configurable storage limits, or any benchmark suite. Those remain the next
round(s) of work (Phase 3B/3C next), unblocked by (not fulfilled by) this PR.
