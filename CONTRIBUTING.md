# Contributing

HDNA is in active research/MVP transition — see
[`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) before opening anything
non-trivial, so your work lands on the current direction rather than a
superseded one.

## Repository layout

- `extension/` — the MV3 browser extension (TypeScript + Svelte).
- `spec/` — protocol/schema types shared across the extension.
- `training/phase5a/` — Test 1's (closed) training/benchmark pipeline.
- `training/test2/` — Test 2's pipeline skeleton (not yet implemented).
- `docs/` — current architecture/product docs; `docs/history/` holds
  superseded experiment narratives.

## Before opening a PR

From `extension/`:

```bash
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # wxt build
```

From the repo root, if you touched `training/phase5a/lore/` or
`training/phase5a/dataset/split_dataset.py`:

```bash
python3 training/phase5a/lore/test_policy_drift.py -v
```

CI (`.github/workflows/ci.yml`) runs all of the above.

## Ground rules

- The canonical localized edit-judgment contract is
  `training/phase5a/lore/task-contract.v3.md` +
  `training/phase5a/lore/policy-spec.v1.json`. They must agree exactly —
  do not hand-duplicate the dimension/direction taxonomy anywhere else.
- Do not reuse Test 1's benchmark cases as Test 2 training or evaluation
  input.
- Follow the existing storage-class discipline
  (`CANONICAL`/`DERIVED`/`CACHE`/`RAW`) and the privacy boundaries in
  `docs/MVP_PRODUCT_CONTRACT.md` for anything touching captured text.
- Keep comments to what the code cannot express itself — non-obvious
  invariants, privacy/security boundaries, platform constraints. Avoid
  narrating implementation history in source files; that belongs in Git
  history or `docs/history/`.

## License

By contributing, you agree your contributions are licensed under
Apache-2.0, the same as the rest of the repository. See [LICENSE](LICENSE).
