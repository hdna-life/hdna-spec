# 0003 — Extension build tooling: WXT

## Decision

Use WXT (with `@wxt-dev/module-svelte`) as the MV3 + Svelte build/dev tooling
for `extension/`, rather than hand-assembling Vite + `@crxjs/vite-plugin` +
`@sveltejs/vite-plugin-svelte`.

## Why the decision was made

The design doc fixes the stack (TypeScript, MV3, Svelte, local-first) but does
not specify build tooling. WXT generates the manifest from config, wires
background/popup entrypoints by file-system convention
(`entrypoints/background.ts`, `entrypoints/popup/`), provides a `defineBackground`
helper with typed lifecycle, and has first-class Svelte support — this
minimizes hand-rolled scaffolding for what the task explicitly asked to be
"the smallest foundation."

## Alternatives considered

Manual Vite + `@crxjs/vite-plugin`: more direct control over the manifest and
build graph, at the cost of hand-writing `manifest.json`, entrypoint wiring,
and Svelte plugin configuration ourselves. Not chosen — no requirement in this
PR needs that level of control, and it directly conflicts with the
"smallest foundation" instruction.

## Research/evidence used

Not applicable — tooling choice, not a technical/architectural claim about
HDNA's design.

## What the AI system was asked to evaluate

Presented as an explicit choice to the operator before implementation. Operator
selected WXT.

## Current validation status

Implemented: `extension/wxt.config.ts`, `entrypoints/background.ts`,
`entrypoints/popup/`. `npx wxt build` produces a loadable MV3 extension
(`.output/chrome-mv3/`, manifest + background.js + popup.html, ~65 KB total,
zero build warnings after CSS scoping was corrected). `npx tsc --noEmit` passes
with the WXT-generated `.wxt/tsconfig.json`.
