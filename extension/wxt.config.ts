import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'HDNA',
    description: 'HDNA local persona runtime — transparency and control UI.',
    permissions: ['storage', 'alarms'],
    // Scoped to exactly the OpenRouter API origin for T3 persona
    // interpretation (docs/decisions/0015) — no broad https://*/* grant.
    // The second entry is Phase 5A Trial 3's local MLX-LM server
    // (docs/decisions/0016's Trial 3 "local MLX transport" addendum) —
    // scoped to exactly the default `mlx_lm.server` origin/port
    // (127.0.0.1:8080), not a broad http://localhost/* or http://*/*
    // grant. Chrome match-pattern syntax supports an explicit port
    // (`scheme://host:port/path`, "By default, this is treated as a
    // wildcard" per Chrome's match-patterns docs), verified before
    // adding this — see docs/decisions/0016's Trial 3 addendum for the
    // verification record. If the operator runs mlx_lm.server on a
    // different port, this permission must be updated to match.
    host_permissions: ['https://openrouter.ai/*', 'http://127.0.0.1:8080/*'],
  },
  srcDir: '.',
  alias: {
    '@spec': '../spec',
  },
});
