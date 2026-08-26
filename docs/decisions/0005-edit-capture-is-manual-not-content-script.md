# 0005 — Edit-event capture is a manual in-popup form, not live content-script scraping

## Decision

This PR's Phase 2 slice captures AI-output → human-edit pairs through an
explicit form in the extension popup (`EditCapture.svelte`) — the user pastes
the AI suggestion and their edited final text and submits. It does **not**
inject content scripts into arbitrary web pages to automatically detect and
diff AI-output/human-edit pairs on live sites (e.g. chat UIs).

## Why the decision was made

The design doc's Phase 2 lists "AI-output → human-edit pairs" as the
highest-value passive-learning signal, and separately says capture should
"return immediately" with deferred processing — both of which this PR
delivers. But it does not specify *how* the pairs are observed. Live capture
would require: `host_permissions` across arbitrary or named sites,
site-specific DOM selectors per AI product (fragile, high-maintenance), and a
real privacy/security review (broad page-content access is a materially
larger trust surface than anything shipped so far). That is a separate,
larger decision the operator should explicitly approve — it isn't implied by
"start Phase 2."

Manual capture proves the entire rest of the Phase 2 architecture end-to-end
— persist/queue/defer, P1 priority, T0 diff metrics, T1 incremental profile,
transparency UI — without opening that surface prematurely.

## Alternatives considered

Content-script-based live capture on a named set of sites — rejected for this
PR: correct scope per the doc's own MVP deferral discipline is the smallest
unit that validates the architecture; broad page access is exactly the kind
of complexity the operator has asked to be flagged rather than assumed.

## Research/evidence used

Not applicable — scope/trust-surface judgment, not a technical claim. The
underlying evidence value of human post-editing itself is `SUPPORTED` per
`docs/research/references.md` (PePe, ACL 2026 post-editing study); this
decision is only about the capture mechanism, not the evidence's validity.

## What the AI system was asked to evaluate

Whether "start Phase 2 passive evidence collection" requires live cross-site
capture in the first slice. Evaluated against the doc's own scope-discipline
rules and flagged as a decision worth recording rather than silently
assuming the larger-surface implementation.

## Current validation status

Implemented and tested: `extension/src/ui/EditCapture.svelte` +
`extension/src/persona/capture.ts`. Live content-script capture remains
`PLANNED`, contingent on a future explicit operator decision covering
`host_permissions` scope and a privacy review.
