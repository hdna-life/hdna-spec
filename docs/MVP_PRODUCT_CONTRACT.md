# HDNA MVP Product Contract

Canonical product direction **after Test 2**, if Test 2 passes. This
replaces the earlier assumption that the production learning source is
AI-output → human-edit comparison. That comparison is a **validated
research primitive** (Test 1), not the product's primary learning
mechanism — see "Relationship to the v3 judge" below.

Test 1 validated tiny-model specialization feasibility only. It did
**not** validate anything described in this document. Nothing here is
implemented; this is a contract to build against once Test 2 passes.

## Product learning pipeline

```
user naturally writes eligible text
        ↓
capture
        ↓
background persisted queue
        ↓
small local Gemma <LEARN>
        ↓
structured style/preference observations
        ↓
deterministic confidence + recency aggregation
        ↓
user-owned HDNA state
        ↓
raw text discarded
```

No per-edit labeling. No questionnaire. No manual persona authoring. The
user keeps writing normally; learning happens locally and automatically.

## The three Gemma tasks

One small local model (target: `google/gemma-3-270m-it`, per Test 2's
direction), three narrow conceptual tasks — never a single unconstrained
"be helpful" prompt:

**`<LEARN>`**
`user-authored text + optional context/domain` → structured style/
preference observations.

**`<REWRITE>`**
`frontier output + relevant HDNA state + context` → same semantic
content, user-adapted expression.

**`<VERIFY>`**
`frontier output + candidate rewrite` → semantic-preservation judgment.

### Relationship to the v3 judge

The existing v3 localized edit-judgment primitive
(`training/phase5a/lore/task-contract.v3.md`) — validated by Test 1 — is
not `<LEARN>`, `<REWRITE>`, or `<VERIFY>`. It is a **validated semantic/
behavior-delta primitive** that can later contribute directly to the
`<VERIFY>` safety gate (verdict + dimensions between frontier output and
candidate rewrite is structurally the same judgment shape). Test 1 did
**not** validate `<LEARN>` or `<REWRITE>` — those require their own
future validation.

## Product boundaries

- The frontier model owns knowledge, reasoning, and content.
- HDNA owns expression adaptation only.
- HDNA may not add or remove facts.
- HDNA may not change recommendations or decisions.
- HDNA may not narrow or expand semantic scope.
- Every rewrite is verified.
- Verify failure or uncertainty → return the original frontier output.
- Already-compatible output may remain byte-for-byte unchanged.
- No numerical "persona distance" system is required for MVP.

## Learned state

**Expression/style behavior:** directness, politeness, formality,
expressed affect, certainty/commitment style, slang, abbreviations,
punctuation habits, spelling/intentional typo habits, capitalization,
emoticons/emoji, humor/wordplay, context-specific expression.

**Repeated preferences**, evidence-weighted:

| Signal | Evidence strength |
|---|---|
| Explicit preference statement | Strong |
| Repeated observed choice | Medium |
| Isolated choice | Weak |

Preferences never silently rewrite frontier content. If a frontier
recommendation conflicts with a sufficiently supported preference, HDNA
may show a soft notification instead of altering the answer:

> "You usually prefer X in similar situations."

Confidence controls notification strength, not content substitution. HDNA
does not maintain a general factual biography or memory in the MVP —
only expression/style behavior and repeated preferences as defined above.

## Privacy contract

Raw personal text is ephemeral — it is **not** persisted in the portable
`.hdna` state. Sensitive fields are blinded **before** capture: password,
payment/card, OTP, seed/private-key-like inputs, and platform-marked
sensitive inputs. The user may configure a site allow/deny scope. Domain
may be retained as minimal optional context; full URLs or browsing
history are not retained for this purpose.

The `.hdna` snapshot contains structured learned state only. It never
contains raw messages, prompts, documents, personal text, browsing
history, or API keys.

MVP export is snapshot-only. Live sync is deferred.

## Zero-install demo contract

Trying HDNA must not require installing the extension.

```
visit hdna.live / bora.hdna.live
        ↓
WebGPU capability check
        ↓
local model begins loading immediately
        ↓
prepared .hdna snapshot
        ↓
choose frontier provider
        ↓
frontier response
        ↓
local rewrite
        ↓
local verify
        ↓
show Frontier vs HDNA
```

The extension is needed only to automatically learn the visitor's own
HDNA state. Visitors may:

1. Use their own provider/OpenRouter API key — client-side, current
   session only, never persisted.
2. Use HDNA's rate-limited prepared frontier setup.

## Status

Not implemented. See `docs/CURRENT_STATE.md` for what has actually been
validated (Test 1) and what is next (Test 2).
