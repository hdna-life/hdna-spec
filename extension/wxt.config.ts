import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'HDNA',
    description: 'HDNA local persona runtime — transparency and control UI.',
    permissions: ['storage', 'alarms'],
    // Scoped to exactly the OpenRouter API origin for T3 persona
    // interpretation (docs/decisions/0015) — no broad https://*/* grant.
    host_permissions: ['https://openrouter.ai/*'],
  },
  srcDir: '.',
  alias: {
    '@spec': '../spec',
  },
});
