import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

/**
 * Regression coverage for docs/decisions/0016's Trial 3 "local MLX
 * transport" addendum §6: the extension must be able to reach the local
 * MLX-LM server from the background context, via the narrowest necessary
 * host permission — exactly the default `mlx_lm.server` origin/port
 * (127.0.0.1:8080), never a broad "any port on localhost" or "any host,
 * any origin" grant. Also guards against silently broadening the pre-existing
 * OpenRouter-only permission (docs/decisions/0015) while making this
 * change.
 */
describe('manifest host_permissions', () => {
  // `manifest` is typed as a union (object | Promise | fn) by wxt's
  // UserConfig, but this project's wxt.config.ts always passes a plain
  // object literal — narrow that one known-actual shape here rather than
  // widen the test's import surface.
  const manifest = config.manifest as { host_permissions?: string[] };
  const hostPermissions = manifest.host_permissions ?? [];

  it('includes the narrow local MLX-LM server origin/port, not a broad localhost/wildcard grant', () => {
    expect(hostPermissions).toContain('http://127.0.0.1:8080/*');
    expect(hostPermissions).not.toContain('http://localhost/*');
    expect(hostPermissions).not.toContain('http://*/*');
    expect(hostPermissions).not.toContain('<all_urls>');
  });

  it('still includes the pre-existing OpenRouter-only permission, unbroadened', () => {
    expect(hostPermissions).toContain('https://openrouter.ai/*');
  });

  it('grants no permission wider than exactly these two origins', () => {
    expect(hostPermissions.sort()).toEqual(['http://127.0.0.1:8080/*', 'https://openrouter.ai/*'].sort());
  });
});
