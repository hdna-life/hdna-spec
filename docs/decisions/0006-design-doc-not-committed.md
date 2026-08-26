# 0006 — Source design/research document is not committed to the repository

## Decision

`hdna-design-research-document.md` is kept on the operator's local disk only
(added to `.gitignore`) and is not part of this repository's tracked history.
An earlier commit on `main` had included it; that commit was rewritten
(orphan branch + force-push) to remove it from history entirely, since the
repository had just been created that session with no other collaborators or
clones.

## Why the decision was made

Explicit operator instruction, given after noticing the file had already been
committed and pushed: the source doc should not be pushed or committed at
all, and any trace of it in already-pushed history should be scrubbed, not
just stopped going forward — private research/design notes are not the same
thing as the repository's specification artifacts, and the operator intends
to produce separate research outputs derived from it later.

## Alternatives considered

Add a removal commit on top of the existing history — rejected by the
operator: the file would remain recoverable from the first commit on GitHub,
which doesn't satisfy "cannot be pushed, don't commit it."

## Research/evidence used

Not applicable — operator directive, not a technical claim.

## What the AI system was asked to evaluate

Whether to scrub already-pushed history (force-push, low risk given the repo
was created and pushed only within the same session) versus a simpler
forward-only removal commit (lower risk of the git operation itself, but
leaves the file recoverable). Presented as an explicit choice; operator chose
full history rewrite.

## Operator feedback recorded

The operator also noted, generally: significant files should not be committed
without asking first. This is treated as standing guidance for future
sessions, not scoped to this one file.

## Current validation status

Done: `main` and every subsequent branch's root history contain only
`.gitignore` at the start; `hdna-design-research-document.md` never appears in
any commit reachable from `origin/main` as of this decision.
