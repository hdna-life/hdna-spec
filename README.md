# HDNA

A local, portable behavioral layer for AI.

Frontier models provide intelligence. HDNA learns how a user naturally
communicates. The goal: change the model without losing the user.

## How it works

```
natural user writing
        ↓
local automatic learning
        ↓
structured, user-owned .hdna state

frontier model
        ↓
raw response
        ↓
local HDNA rewrite
        ↓
semantic verification
        ↓
adapted response
```

HDNA watches how a user naturally writes — no persona questionnaire, no
manual trait editor, no per-edit labeling. Eligible writing is processed
locally in the background while the user continues normal browser use.
The output is a structured, user-owned `.hdna` state: expression/style
behavior (directness, formality, punctuation habits, etc.) and repeated
preferences, each weighted by how strongly it's been observed. Raw
personal writing is never part of the portable `.hdna` snapshot.

The frontier model stays responsible for knowledge, reasoning, and
content — HDNA never silently changes facts, decisions, recommendations,
or semantic scope. It mainly adapts expression. A frontier response is
rewritten locally against the user's `.hdna` state, then semantically
verified against the original; if verification fails or is uncertain, the
original frontier output is returned unchanged.

HDNA may also learn repeated explicit preferences, but these never
silently alter an answer. If a frontier recommendation conflicts with a
sufficiently supported preference, HDNA may surface a small notice
instead — never a silent rewrite. Full contract, boundaries, and privacy
rules: [`docs/MVP_PRODUCT_CONTRACT.md`](docs/MVP_PRODUCT_CONTRACT.md).

The MVP targets one small local model running in the browser via WebGPU
(planned Test 2 student: `google/gemma-3-270m-it`), with three
conceptual tasks — `LEARN` (natural writing → structured behavioral
observations), `REWRITE` (frontier output + HDNA state → personalized
expression with preserved meaning), and `VERIFY` (frontier output +
rewrite → semantic-preservation judgment). None of these three are
validated yet — see "Current evidence" below.

## How it is different

Most current personalization approaches rely on a generated prose persona
prompt (custom instructions, writing-assistant voice profiles) or
provider-native memory tied to one vendor. Common AI memory systems store
general biography/history rather than expression behavior specifically.

| | Most current approaches | HDNA's design instead |
|---|---|---|
| Learning | Manual prompt/profile authoring | Automatic, from natural use |
| State | Prose persona prompt | Structured behavioral state |
| Portability | Provider-specific | Provider-independent |
| Runtime | Server-side | Local (WebGPU) |
| Personalization scope | General memory/biography | Expression/style behavior only |

## Current evidence

**Test 1 — PASS.** `Qwen3-0.6B`, LoRA/SFT on 183 human-reviewed examples,
fresh final benchmark n=10: 80% semantic exact accuracy, 80% human
acceptable — meeting the predeclared 80% threshold. The originally
planned close was n=20; the actual final close used n=10, a documented
protocol deviation. This does **not** prove the complete HDNA product
works — it validates only that a tiny specialized model can learn the
narrow localized-edit behavioral judgment task. Full result:
[`training/phase5a/benchmark/test1-final-result.md`](training/phase5a/benchmark/test1-final-result.md).

**Earlier zero-shot attempt — FAIL.** The tiny model performed poorly
zero-shot, and the failed experiment is preserved in the repository.

**Test 2 — NEXT.** `Gemma 3 270M`, filtered synthetic distillation, a
completely fresh held-out benchmark, and required WebGPU deployment
validation. Not started; no paid generation has run.

Full breakdown of what's demonstrated vs. not: [`EVIDENCE.md`](EVIDENCE.md).

## MVP direction

Trying HDNA will not require installing the extension. Planned demo:
open `hdna.live`, a local WebGPU model loads, a prepared `.hdna` snapshot
is used, you choose or bring a frontier provider, and see Frontier vs.
HDNA side by side. Bring-your-own API key is client-side, current session
only, never persisted. The extension is only needed if you want HDNA to
automatically learn your own `.hdna` state.

## Learn more

- [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) — product status and direction
- [`docs/MVP_PRODUCT_CONTRACT.md`](docs/MVP_PRODUCT_CONTRACT.md) — the full product contract
- [`docs/architecture/mvp-scope.md`](docs/architecture/mvp-scope.md) — implementation scope
- [`EVIDENCE.md`](EVIDENCE.md) — demonstrated / falsified / not yet demonstrated
- [`training/phase5a/benchmark/test1-final-result.md`](training/phase5a/benchmark/test1-final-result.md) — Test 1 result
- [`training/phase5a/lore/task-contract.v3.md`](training/phase5a/lore/task-contract.v3.md) — the canonical edit-judgment contract

## License

Apache-2.0. See [LICENSE](LICENSE).
