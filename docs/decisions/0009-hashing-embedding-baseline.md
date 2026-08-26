# 0009 — Phase 3B: deterministic hashing embedding baseline behind EmbeddingProvider

## Decision

Ship local embeddings + a vector index using a deterministic, dependency-free
character n-gram hashing vector (`HashingEmbeddingProvider`) rather than a
real neural sentence-embedding model, behind a strict, execution-context-
agnostic `EmbeddingProvider` interface. Explicitly treat this as a **non-
semantic temporary baseline** — engineering effort went into the
vector/index/rebuild contract (provider interface, `Embedding` schema,
`EmbeddingStore`, `VectorIndexService.rebuild()`, `cosineSimilarity`/
`queryNearest` retrieval primitives), not into the hashing function's
retrieval quality.

Embedding computation runs inside the existing mode-gated job queue, not a
new execution context: `index_embedding` at `P2` (incremental, per newly
captured evidence) and `rebuild_vector_index` at `P3` (expensive/rare full
rebuild), matching the doc's own queue-class definitions exactly. Query-time
embedding (for the popup's search box) runs directly/synchronously in the
popup — it's a cheap, pure, read-only operation with no storage side effect,
so it doesn't need the queue's backpressure/mode-gating machinery.

## Why the decision was made

Operator's explicit framing: this needs "one model decision," but the
project's dominant constraint so far has been determinism (every existing
piece — stylometry, diff metrics, governor decisions — is a pure, unit-
tested function). A real neural embedding model (e.g. transformers.js +
MiniLM) is a genuinely different category: a 20-90MB download/bundle
decision, WASM/ONNX runtime, and non-deterministic-adjacent behavior needing
fixture-based rather than pure-function testing — plus MV3 service workers
are documented as unreliable hosts for long-lived model state, which would
have forced a new offscreen-document execution context in the same PR as the
model decision itself.

The operator chose to decouple those two decisions: solve the vector/index/
rebuild contract now with a baseline that has zero new dependencies and is
fully pure-function-testable, and keep `EmbeddingProvider` deliberately
execution-context-agnostic (async `embed()`, no DOM/WASM/model assumptions
in the interface) so a future real neural provider is an isolated swap
behind an offscreen/WebGPU executor — nothing outside the provider
implementation changes.

## Alternatives considered

1. Real neural embedding via transformers.js now — rejected for this PR:
   bundles a model-choice decision, a new execution context (offscreen
   document), a download/cache strategy, and a new testing approach all into
   one PR. The operator explicitly separated these.
2. No embeddings yet, defer all of Phase 3B — rejected: the operator wants
   the vector/index/rebuild contract validated now, since Phase 3B's stated
   goal (per `docs/decisions/0008`) is proving that contract before it needs
   to support anything expensive.
3. Run the hashing provider through an offscreen document anyway, for
   architectural symmetry with a future neural provider — rejected: the
   hashing function is synchronous/cheap enough that adding a new extension
   context and message-passing protocol for it would be unjustified
   complexity with no present benefit; the `EmbeddingProvider` interface
   already isolates that future need without paying for it now.

## Research/evidence used

Not applicable to the hashing baseline itself (it's explicitly not a
semantic-similarity claim, so no research claim is being made about
retrieval quality). The doc's own "authorship_embedding != persona" decision
(TACL 2023, `docs/research/references.md`) is the basis for treating any
embedding — hashing or neural — as derived/rebuildable, never canonical,
which this design honors regardless of which provider is behind it.

## What the AI system was asked to evaluate

Operator specified the direction (deterministic baseline, strict interface,
in-queue execution, P2/P3 split) directly. Implemented: the `EmbeddingProvider`
interface shape (async, no context assumptions), the hashing algorithm
(FNV-1a character n-gram hashing trick, L2-normalized), the `VectorIndexService`
rebuild contract, and the P2/P3 job wiring — and evaluated where query-time
embedding should run (direct in the popup vs. queued), landing on direct
since it's a read with no storage side effect, distinct from the "writes go
through the queue" instruction.

## Known limitations

- Not semantic: retrieval reflects character/lexical overlap, not meaning.
  Two paraphrases with no shared substrings will not score as similar. This
  is the explicit, accepted tradeoff, not an oversight.
- `queryNearest` is a linear scan, not an approximate-nearest-neighbor index
  — fine for the MVP's expected local dataset sizes, not scale-tested beyond
  that.
- No UI resolution from a search result back to the original evidence text
  (results show `sourceType:sourceId (score)` only) — kept out to avoid
  wiring extra store-resolution logic in a PR meant to stay focused on the
  index contract itself.

## Current validation status

Implemented and tested:
- `spec/schema/embedding.ts`, `spec/protocol/embedding-provider.ts`.
- `extension/src/persona/hashing-embedding-provider.ts` — 7 tests
  (determinism, dimensionality, L2 normalization, empty-text handling — this
  test caught a real bug: `charNgrams('', 3)` was hashing a single empty-
  string gram instead of producing zero grams, so "empty text" wasn't
  actually a zero vector — fixed — case-insensitivity, near-duplicate vs.
  unrelated-text self-consistency, stable extractor identity).
- `extension/src/persona/vector-index.ts` (`cosineSimilarity`, `queryNearest`)
  — 8 tests.
- `extension/src/persona/embedding-store.ts` — 5 tests, `DERIVED` class.
- `extension/src/persona/vector-index-service.ts` — 4 tests, including a
  rebuild test proving a stale embedding does not survive rebuild, and an
  end-to-end test with the real provider.
- `extension/src/persona/embedding-sources.ts` — 2 tests (writing samples
  and edit events, the latter embedding the human-edited `finalText`, not the
  AI's `sourceText`).
- `extension/src/queue/processors/embedding-jobs.ts` — 4 tests confirming
  P2/P3 enqueue priorities and correct execution.
- 142/142 tests pass, clean typecheck, clean build (91.1 KB total — no
  bundle-size increase from a model, confirming the "zero new dependency"
  property).
