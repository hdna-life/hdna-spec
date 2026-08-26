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

## Post-implementation fix: settings-form hydration bug (found via manual testing)

Manual testing on the real unpacked extension found that `TraitsBeliefsSummary.svelte`
lost its displayed settings on popup close/reopen: after saving an API key,
model id, and `Enabled`, closing the popup, and reopening it, the form
rendered `Enabled` unchecked and the API-key field empty, even though
`chrome.storage.local` still held the correct config.

**Root cause.** The form hydrated its input fields from the `config` prop
inside `$: if (!initialized) { ...; initialized = true; }` — a one-shot
latch. `App.svelte` passes a placeholder default (`{ enabled: false }`)
synchronously on mount, then updates the prop asynchronously once
`refresh()`'s `chrome.storage.local` read resolves a tick later. The latch
fired on the *first* (placeholder) value and never accepted the second
(real) one, so the form always displayed the placeholder default after a
fresh mount — which happens on every popup open, since the popup page is
torn down on close and rebuilt from scratch on reopen. Separately, this
made an actual data-loss path reachable: if a user clicked "Save" while the
form displayed this stale blank/disabled state, it would overwrite the
real, working config with an empty/disabled one — a plausible explanation,
independent of any queue/scheduling issue, for a subsequent interpretation
attempt making zero OpenRouter requests.

**Fix.** `extension/src/persona/persona-interpreter-form-state.ts` (new)
extracts the hydration decision into a pure `computeFormHydration(dirty, config)`
function with no one-shot latch — it recomputes fresh from `config` on
every call, gated only by whether the user has an in-progress edit
(`dirty`, set on first keystroke/checkbox toggle in the form, never reset
mid-session). This fixes the close/reopen bug (a second, later `config`
value is no longer ignored) while still satisfying the requirement that
the parent's 2s `refresh()` poll must never clobber an unsaved edit (`dirty`
short-circuits hydration entirely). A second function,
`resolveSavedConfig(fields, currentConfig)`, is an independent safeguard
against the data-loss path above: it preserves the existing saved API key
when the input is left blank rather than persisting an empty string, since
the field is deliberately never pre-filled with the real secret (see
below). Both are unit-tested directly (`extension/tests/persona/persona-interpreter-form-state.test.ts`),
since no Svelte component-test infrastructure exists in this repo — the
same "extract the derivation into a pure, testable function" pattern used
for the T2 panel's abstention-state fix on the sibling branch.

**Also added while investigating**, per explicit operator request to make
the service's existing pre-network exits observable rather than only
inferable after the fact from an empty OpenRouter dashboard: a third pure
function, `deriveInterpretationReadiness(config, eligible)`, mirrors the
exact two checks `PersonaInterpreterService.interpret()` itself performs
(`not-configured` when disabled/missing key/missing model id,
`below-threshold` when `isEligibleForInterpretation()` fails, `ready`
otherwise) and drives a status line in the panel shown *before* the user
clicks "Interpret." `App.svelte` computes the `eligible` flag with the
same `isEligibleForInterpretation()`/`DEFAULT_PERSONA_INTERPRETER_POLICY`
the service uses, so the UI and the service can never disagree about
whether a given state will make a network call.

**Full-pipeline verification.** Per explicit operator request to rule out
(rather than assume away) a `chrome.storage.local` context-sharing or
service-worker-restart issue as the actual root cause, and to make sure a
pre-network exit is distinguishable from a real successful run at the job
level too, `extension/tests/persona/persona-interpretation-integration.test.ts`
(new) exercises the full path with no mocking of `chrome.storage.local`'s
sharing behavior beyond a single shared in-memory fake standing in for the
browser's real (genuinely global) storage: a config saved through one
`PersonaInterpreterConfigStore` instance ("popup") is read by a completely
independent set of instances ("background") all the way through to an
actual `fetch()` call; the same holds across a simulated service-worker
restart (a second "background" instance, sharing no in-memory state with
the first, still sees what was persisted); and the two pre-network exits
are confirmed at the job-queue level — `not-configured` surfaces as a
`FAILED` job with a clear `lastError` (not a silent no-op), and
`below-threshold` surfaces as `COMPLETE` with the provider factory and
`fetch` both provably never invoked, distinguishing "correctly did
nothing" from "silently succeeded."

No bug was found in `chrome.storage.local` sharing or restart survival
itself — `PersonaInterpreterConfigStore` has no in-memory state at all,
so there was nothing for a restart to lose, and `chrome.storage.local` is
inherently shared across all extension execution contexts by the browser
platform, not by anything this codebase controls. The settings-form
hydration bug above remains the identified, fixed root cause.

## Post-hydration-fix investigation: deterministic eligibility path against real data

A second manual retest, after the hydration fix above, still saw zero
OpenRouter requests, with the popup showing "No traits/beliefs interpreted
yet (patterns may still be below threshold)." The operator's real
persisted corpus (`docs/validation/manual-mvp-validation.md`, Phase 4)
compiled exactly two Patterns: `compressionRatio/unscoped` (value 0.84,
sampleCount 5) and `lexicalOverlap/unscoped` (value 0.09, sampleCount 5).
The operator asked for the deterministic eligibility path to be inspected
against this exact data before assuming any other cause, and explicitly
asked not to weaken the threshold just to make a request fire.

**Finding: this exact pair is eligible under the current implementation
and the current default policy — no bug found in the eligibility path.**
`isEligibleForInterpretation(patterns, policy)` is `patterns.length >=
policy.minPatternCount` — nothing else. It does not re-check per-pattern
`sampleCount`/`confidenceWeight` (already enforced one layer down by
`PatternCompilerPolicy` before a `Pattern` ever reaches `PatternStore`),
does not require specific dimensions, and does not filter by `context`
beyond whatever `Pattern.context` already is. Two Patterns with two
distinct dimensions (`compressionRatio`, `lexicalOverlap`), both real,
both already persisted, evaluate `2 >= 2` — `true` — exactly matching this
policy's stated intent ("gates on having enough *distinct* patterns to
interpret"). Verified three ways:
1. A direct unit-test fixture using the operator's exact real values
   (`extension/tests/persona/persona-interpreter.test.ts`, "is eligible
   for the operator's real persisted corpus") confirms
   `isEligibleForInterpretation` returns `true`.
2. Confirmed by direct code inspection that `entrypoints/popup/App.svelte`
   (the UI's `eligible` computation) and
   `extension/src/persona/persona-interpreter-service.ts` (the actual gate
   before any network call) both import and call the identical
   `isEligibleForInterpretation` function from
   `extension/src/persona/persona-interpreter.ts` against the identical
   `DEFAULT_PERSONA_INTERPRETER_POLICY` from
   `spec/schema/persona-interpreter-policy.ts` — `entrypoints/background.ts`
   constructs `PersonaInterpreterService` without overriding the policy.
   There is no second copy of this logic anywhere to have drifted out of
   sync.
3. A full end-to-end integration test seeding `PatternStore` with these
   exact two records and running the real job pipeline —
   `extension/tests/persona/persona-interpretation-integration.test.ts`,
   "reaches fetch() exactly once for the operator's exact real persisted
   corpus" — confirms `PatternStore.list()` → `isEligibleForInterpretation`
   (`true`) → the P3 processor → `PersonaInterpreterService` → the
   provider factory → `fetch()`, called exactly once, with no mocking of
   the eligibility/gating logic itself.

**No policy change was made** — the operator explicitly asked not to
weaken the threshold to force a request, and no weakening was needed:
the exact real data already clears `DEFAULT_PERSONA_INTERPRETER_POLICY`
as originally intended.

**Most likely actual explanation for the observed zero requests: P3/`DEEP_IDLE`
dispatch latency, not an eligibility bug.** `interpret_traits_beliefs` is
enqueued at `P3`, and `ALLOWED_PRIORITIES_BY_MODE` (`extension/src/governor/mode-priorities.ts`)
only allows `P3` jobs to dispatch in `DEEP_IDLE` mode — reached only after
`DEEP_IDLE_AFTER_INACTIVE_MS` (90s) of continuous foreground inactivity
with the popup closed (`docs/decisions/0013`, `0014`). This is identical,
intentional behavior to every other rebuild-style button in this popup
(`Rebuild T2 Profile`, `Rebuild index`, `Compile patterns`), and is exactly
the same class of "job stays PENDING with zero visible effect until
DEEP_IDLE is reached" behavior manually found and documented for this
codebase before (`docs/validation/manual-mvp-validation.md`). If the
operator checked OpenRouter's dashboard shortly after clicking "Interpret
traits/beliefs" without leaving the popup closed and the browser idle for
90+ seconds, a `PENDING` `interpret_traits_beliefs` job making zero
requests is the expected, correct state — not a bug. This is not confirmed
as *the* explanation (it wasn't directly observed in this investigation),
but it is the most likely one once the eligibility path itself is ruled
out, and it is now easier to rule in or out directly: the Queue panel's
`P3` count reflects whether the job is still pending, and the new "Ready —
… may not fire immediately if the popup stays open — see the Queue panel's
P3 count" copy (see UI diagnostics below) surfaces this in the panel
itself rather than requiring a read of this document.

**UI diagnostics made more specific.** `deriveInterpretationReadiness()`
(`extension/src/persona/persona-interpreter-form-state.ts`) now returns a
structured result instead of a bare string: `{ kind: 'not-configured',
missing: [...] }` names exactly which of `enabled`/`apiKey`/`modelId` is
missing (previously a single generic "not configured" message covered all
three); `{ kind: 'below-threshold' }` is rendered with the actual counts
("Not eligible: 2 pattern(s) found; requires at least 2" — deliberately
worded as the operator requested, so a below-threshold state that somehow
disagreed with the real numbers would be immediately visible as a bug
rather than hidden behind vague wording); `{ kind: 'ready' }` now also
notes the P3/background-job caveat above.

## Post-eligibility-verification fix: `fetch` "Illegal invocation" (the actual root cause)

The P3/`DEEP_IDLE` latency theory above was not it. A further manual
dogfood pass — this time actually waiting long enough for the job to
dispatch — found every `interpret_traits_beliefs` job reaching the
processor and failing with `status: FAILED`, `lastError: "Failed to
execute 'fetch' on 'WorkerGlobalScope': Illegal invocation"`. OpenRouter
received zero requests because the failure happens before any HTTP leaves
the extension — consistent with every earlier observation of "zero
requests," but for a reason unrelated to eligibility, config hydration, or
scheduling.

**Root cause.** `OpenRouterPersonaInterpreter`'s constructor defaulted
`fetchImpl` to a bare reference to the global `fetch` function:
```ts
constructor(
  private apiKey: string,
  readonly modelId: string,
  private fetchImpl: typeof fetch = fetch,
) {}
```
`interpret()` then calls it as `this.fetchImpl(...)`. Native `fetch` is a
brand-checked WebIDL method — internally it requires its receiver (`this`
at the call site) to be the global object (`Window`/`WorkerGlobalScope`)
it was defined on. `obj.method(...)` call syntax sets the receiver to
`obj`; here `this.fetchImpl(...)` sets the receiver to the
`OpenRouterPersonaInterpreter` instance, not `globalThis` — so the
brand check fails and the native implementation throws exactly the
observed `TypeError`. This reproduces in a real MV3 service worker (where
`fetchImpl` was never overridden — see `entrypoints/background.ts`'s
provider factory, `(apiKey, modelId) => new OpenRouterPersonaInterpreter(apiKey, modelId)`,
which always uses the default) but not in any of this decision's existing
unit tests, since every one of them explicitly passes its own fake
`fetchImpl` — a plain function with no brand check to trip.

**Fix.** Bind the default to `globalThis` explicitly:
```ts
private fetchImpl: typeof fetch = fetch.bind(globalThis),
```
A bound function ignores the call-site receiver entirely, so
`this.fetchImpl(...)` now always invokes native `fetch` with the receiver
it was bound to (`globalThis`), regardless of how the bound reference is
later called.

**Regression coverage.** `extension/tests/persona/openrouter-persona-interpreter.test.ts`
adds a fake global `fetch` (`installBrandCheckedGlobalFetch()`) that
throws the exact same `TypeError` unless invoked with `globalThis` as
`this` — genuinely reproducing the brand-check behavior responsible for
the bug, not just asserting on a call count. A new test constructs
`OpenRouterPersonaInterpreter` with **no** `fetchImpl` argument (exercising
the real default path background.ts actually uses) and confirms
`interpret()` resolves instead of throwing. Confirmed this test fails
with the exact reported error message against the pre-fix code (`private
fetchImpl: typeof fetch = fetch`) and passes against the fix.

This is the confirmed root cause of the "zero OpenRouter requests" symptom
across all three manual dogfood rounds on this feature — not the
config-hydration bug (real, fixed, but not the reason fetch itself never
fired once the job did dispatch and run), not the eligibility path
(verified correct against the operator's real data), and not (as far as
manual testing has shown) P3/`DEEP_IDLE` scheduling latency, though that
remains real, intentional, pre-existing behavior worth keeping in mind
separately.

## Current validation status

Implemented and tested across `spec/schema/trait-belief.ts`,
`spec/schema/persona-interpreter-policy.ts`,
`spec/protocol/persona-interpreter.ts`,
`extension/src/persona/persona-interpreter.ts`,
`extension/src/persona/trait-belief-store.ts`,
`extension/src/persona/persona-interpreter-config-store.ts`,
`extension/src/persona/openrouter-persona-interpreter.ts`,
`extension/src/persona/persona-interpreter-service.ts`,
`extension/src/queue/processors/persona-interpretation-job.ts`,
`extension/src/persona/persona-interpreter-form-state.ts`,
`entrypoints/background.ts`, `extension/wxt.config.ts`,
`extension/src/ui/TraitsBeliefsSummary.svelte`,
`entrypoints/popup/App.svelte`:

- `extension/tests/persona/persona-interpreter.test.ts` — pure functions:
  `toPatternCandidate` minimization, `isEligibleForInterpretation`
  threshold behavior (including the operator's exact real persisted
  corpus fixture), `validateClaimDraft` (valid draft, out-of-range
  confidence, empty claim, no supporting keys, hallucinated supporting
  key).
- `extension/tests/persona/trait-belief-store.test.ts` — CRUD, `DERIVED`
  classification, mirroring `pattern-store.test.ts`.
- `extension/tests/persona/persona-interpreter-config-store.test.ts` — CRUD
  against a minimal in-memory `chrome.storage.local` fake, with zero
  `StorageAdapter`/`fake-indexeddb` dependency in the file as part of the
  proof that this store never touches the persona storage taxonomy.
- `extension/tests/persona/openrouter-persona-interpreter.test.ts` —
  injected fake `fetch`: request URL/model/auth-header/structured-output
  schema shape, confirms no raw evidence text in the outbound payload,
  valid-response parsing, and error paths (non-ok HTTP, non-JSON content,
  schema-mismatched claims); plus a regression test using a brand-checked
  fake global `fetch` (throws unless called with `globalThis` as `this`,
  mirroring the real native implementation) against the *default*
  `fetchImpl` (no argument passed) — confirmed failing with the exact
  reported `TypeError` before the `fetch.bind(globalThis)` fix, passing
  after it.
- `extension/tests/persona/persona-interpreter-service.test.ts` — fake
  provider: throws when not configured; no-op with zero provider calls
  below threshold; happy path writes only validated claims and drops an
  invalid draft; confirms the provider is called with candidates only
  (never the previous claim set); confirms a fresh run atomically replaces
  a stale prior claim.
- `extension/tests/queue/persona-interpretation-job.test.ts` — mirrors
  `pattern-compilation-job.test.ts`: P3 priority, `enqueueSingleton`
  coalescing, processor invokes `service.interpret()`.
- `extension/tests/persona/persona-interpreter-form-state.test.ts` (new) —
  `computeFormHydration` (initial placeholder-default hydration, the
  close/reopen regression: a later real config is no longer ignored, the
  API key is never re-inserted into the input, `dirty` blocks hydration
  including across a legitimate save round-trip), `resolveSavedConfig` (new
  key wins, blank/whitespace-only field preserves the existing key, no key
  ever saved stays `undefined`), `deriveInterpretationReadiness` (each
  individually-named missing field, multiple missing fields at once,
  below-threshold, ready).
- `extension/tests/persona/persona-interpretation-integration.test.ts`
  (new) — full pipeline with a shared fake `chrome.storage.local` and
  `fake-indexeddb`: a "popup"-saved config is read by an independently
  constructed "background" instance through to an actual `fetch()` call;
  the same survives a simulated service-worker restart (a second
  "background" instance sharing no in-memory state with the first); a
  not-configured run fails observably (`FAILED`, clear `lastError`, zero
  provider/fetch calls) instead of looking like a silent no-op; a
  below-threshold run completes with zero provider/fetch calls, provably
  distinguishing "correctly did nothing" from "silently succeeded"; and the
  operator's exact real persisted corpus (`compressionRatio/unscoped`
  value 0.84/sampleCount 5, `lexicalOverlap/unscoped` value 0.09/sampleCount 5)
  reaches an actual `fetch()` call exactly once end to end.
- 295/295 tests pass, clean `tsc --noEmit`, clean `wxt build` (confirmed
  `host_permissions: ["https://openrouter.ai/*"]` present in the generated
  manifest).
- Not yet exercised (at the time of the sections above): an actual
  OpenRouter API key against a real model — left to the operator's own
  manual validation pass, per this repo's established pattern (see
  `docs/validation/manual-mvp-validation.md`). That pass has since
  happened — see the two sections below.

## Positive result: T3 pipeline execution confirmed against the real OpenRouter API

After the MV3 unbound-`fetch` runtime bug fix above, the operator ran the
first real end-to-end T3 dogfood test with an actual OpenRouter API key
and model, using real operator evidence already persisted from earlier
phases. It completed successfully. This confirms, against the real
extension and a real external API (not mocks):

1. canonical evidence → derived metrics works,
2. deterministic pattern compilation works,
3. P3 interpretation scheduling works,
4. minimized `PatternCandidate` transfer to OpenRouter works,
5. structured T3 interpretation and persistence works.

The failure documented in the next section — a limitation in how much
persona-relevant meaning the current two-dimensional deterministic
representation carries — is a finding about **persona information
richness**, not about pipeline execution. The pipeline itself, including
the network call this whole decision exists to make possible, is
confirmed working end to end.

## HUMAN-OPERATOR OBSERVATION / MVP DOGFOOD FINDING — T3 representation bottleneck

**This section records a real operator observation from the first
successful real-API T3 run, not an academic or theoretical claim.** It
does not change any implementation or architecture decision in this PR —
recorded for a future architecture/research decision, per the operator's
explicit instruction not to weaken evidence thresholds, add speculative T3
prompting, or simply feed more samples through the same two dimensions in
response.

### What ran

The real deterministic pattern set available to T3 for this run was:

- `compressionRatio / unscoped`: ≈0.84 (5 supporting edit observations)
- `lexicalOverlap / unscoped`: ≈0.09 (5 supporting edit observations)

The provider produced semantic claims broadly equivalent to:

- compressed communication suggests efficiency/clarity
- low lexical overlap suggests originality/distinctiveness in word choice

### Observation

The T3 network/provider pipeline works, but the two available
deterministic dimensions do not contain enough semantic information to
construct a meaningful persona.

`compressionRatio` and `lexicalOverlap` describe **how strongly** a human
transforms an AI draft at a lexical/length level. They do not describe
enough of:

- what the user believes,
- what the user prefers,
- why the user rejected or changed an AI suggestion,
- how the user makes decisions,
- which trade-offs the user consistently chooses,
- how behavior changes by context,
- recurring semantic preferences or reasoning patterns.

Therefore, increasing the number of observations while continuing to
reduce them to the same two dimensions would primarily improve confidence
in those two measurements; it would not proportionally increase persona
expressiveness.

**This is an information-representation bottleneck, not merely a
sample-count problem.**

### Concrete operator example

A real AI → human edit may contain a high-information preference such as:

> "validate the MVP/core idea before spending development effort on
> additional features"

The current pipeline can observe properties such as compression and
lexical replacement, but that semantic preference itself is lost before
T3. Once reduced to:

```
AI output + human edit
    ->
compressionRatio
lexicalOverlap
```

T3 cannot reconstruct the discarded semantic information without
speculation.

### T3 output quality observation

The first real T3 output also crossed from observable behavior into
unsupported motivation:

- compression was interpreted as a preference for "efficiency and
  clarity"
- low lexical overlap was interpreted as valuing "originality or
  distinctiveness"

Those interpretations are plausible, but the supplied patterns do not
establish those motivations. For example:

```
low lexical overlap != evidence that the user values originality
compression          != evidence that the user values clarity
```

The model is being asked to infer a richer persona than its input
representation can support. **This is important: the limitation is not
necessarily the LLM's reasoning capability. The semantic information was
already discarded upstream**, before it ever reached T3 — consistent with
`validateClaimDraft()`'s existing supporting-evidence-key check (which
confirms a claim cites real patterns) but which has no way to check
whether those patterns actually carry enough semantic content to support
the claim's substance.

### Human-operator conclusion

The first real T3 dogfood test validates the five pipeline-execution
points in the section above. However, it also establishes that **the
current two-dimensional deterministic pattern representation is
insufficient for meaningful persona construction.**

**Do NOT respond to this finding by:**
- weakening evidence thresholds,
- adding speculative T3 prompting, or
- simply feeding substantially more samples through the same two
  dimensions.

**The next research/architecture problem this points to (not an
implementation decision made in this PR):**

> How can HDNA derive higher-information semantic behavioral/preference
> evidence from local canonical evidence — particularly AI-output →
> human-edit deltas — while preserving the local-sovereign,
> minimized-disclosure architecture?

**Potential future direction, explicitly NOT an implementation decision
yet:**

```
AI output + human edit
    ->
semantic preference / behavioral delta candidates
    ->
repetition + evidence thresholds + context aggregation
    ->
semantic patterns
    ->
T3 traits/beliefs
```

A single semantic observation must not automatically become an
established trait/belief — any future work here must preserve the
existing evidence → repeated pattern → interpretation discipline this
decision and `docs/decisions/0011` already established, not bypass it.
