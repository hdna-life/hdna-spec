# 0015 — T3: PATTERNS → TRAITS/BELIEFS persona interpretation via OpenRouter

## Decision

Implements the design doc's T3 step — "rare persona-model interpretation" —
deferred by `docs/decisions/0011` pending its own explicit model/provider
decision. This is the project's first network/LLM dependency.

**Provider-agnostic interface, OpenRouter as the first concrete
implementation.** `spec/protocol/persona-interpreter.ts` defines
`PersonaInterpreterProvider` with the same "execution-context-agnostic"
shape as `EmbeddingProvider`/`TinyClassifier` (`providerId`, `modelId`,
one async method) — no `fetch`/API-key/HTTP concept in the interface
itself. `OpenRouterPersonaInterpreter`
(`extension/src/persona/openrouter-persona-interpreter.ts`) is the sole
concrete implementation and the sole owner of `fetch`/credential handling.
OpenRouter is treated as a model gateway, not a hard dependency on any one
model — `modelId` is caller-configurable, read fresh from config on every
run (see below), never hardcoded.

**Structured, schema-validated output only.** The OpenRouter request sets
`response_format: { type: 'json_schema', ... }` describing the exact
`TraitBeliefClaimDraft[]` shape. A second, defensive validation pass
(`validateClaimDraft()`, `extension/src/persona/persona-interpreter.ts`)
runs on the parsed response regardless, since a schema hint doesn't
guarantee an upstream model honors it perfectly: it rejects any draft with
out-of-range confidence, an empty claim, or a `supportingPatternKeys` entry
that wasn't actually one of the candidates given to the model (a
hallucinated evidence link). Malformed/unparseable responses throw — the
job ends `FAILED`, same as every other processor's error path — rather than
inventing fallback data.

**Data minimization: only minimized Pattern aggregates leave the device.**
`PatternCandidate` (`spec/protocol/persona-interpreter.ts`) is the
minimization boundary — `dimension`/`context`/`value`/`sampleCount` only,
deliberately dropping `Pattern.supportingRecordIds`/`compilerId`/
`compilerVersion`/`computedAt`. Nothing that could hint at raw evidence
structure crosses this boundary, and the provider class never receives
writing samples or edit events directly — it structurally cannot, since
`PersonaInterpreterService` never passes them in.

**A deterministic evidence-threshold gate precedes any network call.**
`isEligibleForInterpretation()` requires at least
`PersonaInterpreterPolicy.minPatternCount` (default 2) distinct
`dimension:context` patterns before `PersonaInterpreterService.interpret()`
calls the provider at all — implementing the design doc's "if not
sufficient, no semantic trait inference happens." Below threshold, the job
completes normally with the existing `TraitBeliefStore` contents untouched,
mirroring how `PatternCompilerService` emits zero patterns below its own
threshold rather than failing.

**No self-reinforcing drift: interpretation never sees its own prior
output.** `PersonaInterpreterProvider.interpret()` takes only the current
`PatternCandidate[]` — never the previous `TraitBeliefClaim[]`. Each run
fully replaces the prior claim set (clear + write), the same full-rebuild
contract as every other DERIVED store in this codebase, but deliberately
without feeding a model's own earlier claims back in as if they were
observations. Claims are themselves model-generated, not raw evidence, so
doing so would let an early claim reinforce or amplify itself across
successive runs with no counterbalancing signal.

**Credentials are not persona data.** The OpenRouter API key (and its
paired `modelId`/`enabled` preferences) live in
`PersonaInterpreterConfigStore`
(`extension/src/persona/persona-interpreter-config-store.ts`), which talks
to `chrome.storage.local` directly — **not** `StorageAdapter`/IndexedDB,
and **not** classified as `CANONICAL`/`DERIVED`/`CACHE`/`RAW`. A credential
is local secret/config state, not persona evidence: it must never surface
through `StorageAdapter.usageByClass()`/`listRecordMeta()` (the
storage-accounting UI, eviction planning) or any future persona-export/
evidence API that walks the `StorageAdapter` stores. Using a structurally
separate browser API makes that guarantee real rather than a convention a
future `StorageAdapter.query()` call could quietly violate. Documented
explicitly in the store's docstring: this is plain local browser storage,
**not** cryptographic secret protection.

`PersonaInterpreterService` is constructed once at service-worker startup
(`entrypoints/background.ts`) but is given a *provider factory*
(`(apiKey, modelId) => PersonaInterpreterProvider`), not a fixed provider
instance — the concrete `OpenRouterPersonaInterpreter` is built fresh from
`PersonaInterpreterConfigStore`'s current contents on every `interpret()`
call, so a config change from the popup is picked up on the very next run
without waiting for a service-worker restart, and no API key is cached in
the worker's in-memory closure.

**Narrowly scoped network permission.** `extension/wxt.config.ts` adds
`host_permissions: ['https://openrouter.ai/*']` — the exact origin, not a
broad `https://*/*` grant.

**Job wiring mirrors `compile_patterns` exactly** (P3, `enqueueSingleton`,
no per-item variant — interpretation only ever runs as a full pass):
`INTERPRET_TRAITS_BELIEFS_JOB` in
`extension/src/queue/processors/persona-interpretation-job.ts`.

**UI**: `TraitsBeliefsSummary.svelte` lists claims and their supporting-
pattern counts, an "Interpret traits/beliefs" trigger button, and an inline
settings form (API key, model id, enabled checkbox) — no new WXT `options`
entrypoint, since none exists today and one is unnecessary surface area for
a single settings block in what the repo already treats as "a
developer-facing MVP popup."

## Why the decision was made

Operator's explicit framing for this phase (confirmed via clarifying
questions before implementation):
- Provider-agnostic interface; OpenRouter (a gateway, not a single model)
  as the concrete MVP implementation; model selection configurable.
- Structured/schema-validated output required.
- Only minimized `PatternCandidate` data leaves the device by default —
  never raw canonical evidence, unless a future explicit policy decision
  allows it.
- User supplies their own OpenRouter key via the popup UI.
- `host_permissions` scoped to the concrete provider's exact origin, not a
  broad grant — expand explicitly later if/when another provider is added.

Two corrections came from operator review of the initial plan, both applied
before any code was written:
1. **Credential storage must not be classified as persona data.** The
   initial plan proposed storing the API key through `StorageAdapter` as
   `CANONICAL`. The operator rejected this: credentials are local
   secret/config state outside the `CANONICAL`/`DERIVED`/`RAW`/`CACHE`
   taxonomy entirely, and must never participate in persona export,
   storage accounting/eviction, provenance, sync, or evidence APIs.
   `chrome.storage.local` was explicitly approved for the MVP credential,
   with the requirement to document it as plain local storage, not
   cryptographic secret protection.
2. **Interpretation must not feed its own prior output back in as
   evidence.** The initial plan passed the existing `TraitBeliefClaim[]` to
   the provider alongside new `PatternCandidate[]`, per the design doc's
   "existing profile + new aggregate statistics ... → candidate claim"
   phrasing. The operator flagged this as a self-reinforcing-drift risk for
   full-rebuild MVP semantics — a model's own earlier claim becoming
   "evidence" for regenerating itself, with no counterbalancing signal —
   and asked for interpretation from current `PatternCandidate`s only,
   then atomic replacement of the previous claim set. No justification for
   keeping `existingClaims` was found strong enough to override this, so it
   was dropped from the interface entirely rather than left in unused.

## Alternatives considered

1. A hardcoded single frontier-model provider (e.g. only Anthropic or only
   OpenAI) — rejected per operator direction: OpenRouter's gateway model
   keeps the concrete implementation swappable at the model level without
   a code change, and the `PersonaInterpreterProvider` interface stays
   provider-agnostic regardless, so a non-OpenRouter provider remains a
   pure addition later, not a rewrite.
2. Passing the previous claim set to the provider as context (the design
   doc's literal phrasing) — rejected per operator review; see "Why" above.
3. Storing the API key through `StorageAdapter` as `CANONICAL` — rejected
   per operator review; see "Why" above.
4. A stricter per-pattern re-threshold inside `PersonaInterpreterPolicy`
   (sample count, confidence weight) — rejected as redundant:
   `PatternCompilerPolicy` (0011) already gates what ever reaches
   `PatternStore`, so `PersonaInterpreterPolicy` only needs to gate on
   having enough *distinct* patterns to interpret, not re-litigate
   per-pattern quality.
5. A dedicated WXT `options` page for the API key/model settings — rejected
   as unnecessary surface area; no options page exists today, and a single
   inline settings block inside `TraitsBeliefsSummary.svelte` covers the
   need without adding a new entrypoint/manifest surface.

## Research/evidence used

OpenRouter's chat-completions API is OpenAI-compatible, including
`response_format: { type: 'json_schema' }` structured-output support — used
as-is, no new library dependency added (the codebase has never added an ML
or HTTP-client dependency; this fix keeps that discipline, using the
platform `fetch`).

## What the AI system was asked to evaluate

The operator specified the boundary directly (provider-agnostic interface
with OpenRouter as MVP concrete impl, configurable model, structured
output, data-minimization default, BYO API key via popup UI, scoped
`host_permissions`) via clarifying questions before any code was written.
The system was asked to design and implement: the
`PersonaInterpreterProvider`/`PatternCandidate`/`TraitBeliefClaimDraft`
contract, the `TraitBeliefClaim` schema (previously nonexistent in this
codebase — confirmed by search before designing it), the deterministic
threshold policy, the `OpenRouterPersonaInterpreter` concrete
implementation and its structured-output request/response validation, the
`PersonaInterpreterService` orchestration (including the
provider-factory-not-fixed-instance detail for fresh credentials per run),
the job/queue wiring mirroring `compile_patterns`, the popup UI panel and
settings form, and full test coverage with no real network calls. Two
architectural corrections (credential storage classification,
no-self-reinforcing-drift) were supplied by the operator during plan review
and incorporated before implementation began — see "Why" above.

## Known limitations

- `PersonaInterpreterConfigStore` provides no encryption of the stored API
  key beyond whatever Chrome provides for extension local storage — anyone
  with local machine/profile access to the browser profile can read it.
  Explicit, documented tradeoff for the MVP BYO-key model, not an oversight.
- `chrome.storage.local`'s `get`/`set` are used directly rather than
  through any abstraction, so there is no atomic multi-key write guarantee
  analogous to `StorageAdapter.putMany()` — not needed here since the
  config is a single key/value pair written as one `set()` call.
- No per-request cost/rate limiting, retry, or spend cap — a
  misconfigured `minPatternCount` or repeated manual "Interpret" clicks
  before completion is only bounded by `enqueueSingleton`'s existing
  coalescing (one outstanding job at a time), not by any cost-awareness
  logic. Left out as unrequested scope for this phase.
- `TraitBeliefClaimDraft`'s JSON-schema hint sent to OpenRouter does not
  guarantee every downstream model actually honors `strict: true` —
  `validateClaimDraft()` is the real enforcement point, by design.
- Model choice/quality is entirely the user's responsibility via the
  `modelId` field; no default model is hardcoded or recommended beyond a
  UI placeholder suggestion.
- The popup's settings form autosaves nothing incrementally — a user must
  click "Save" for the key/model/enabled state to take effect on the next
  job run.


## Outcome / status today

The T3 pipeline this decision implements ran successfully against the
real OpenRouter API and confirmed pipeline execution end to end. It also
surfaced a real finding: the two-dimensional deterministic pattern
representation available at the time (`compressionRatio`, `lexicalOverlap`)
was information-poor for persona construction — this finding motivated
the Phase 5A roadmap pivot (`docs/decisions/0016`), which itself has since
been superseded by Phase 5A Trial 4 / Test 1's closure (CLOSED — SUCCESS,
see `training/phase5a/benchmark/test1-final-result.md`).

The post-implementation debugging journal (a settings-form hydration bug,
an eligibility-path investigation, the real `fetch` "Illegal invocation"
root cause, full validation status at that point in time) and the full
dogfood-finding writeup are preserved verbatim in
`docs/history/experiments/0015-t3-openrouter-history.md`.
