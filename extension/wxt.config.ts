import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'HDNA',
    description: 'HDNA local persona runtime — transparency and control UI.',
    permissions: ['storage', 'alarms'],
  },
  srcDir: '.',
  alias: {
    '@spec': '../spec',
  },
});
