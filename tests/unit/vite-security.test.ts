import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';

import { CSP, HEADER_CSP, cspPlugin, pinnedEngine, vendorList } from '../../vite.security';

// Review round 7, PLAT-2, PLAT-3 and DRIFT-1.

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

/** Calls a plugin hook the way Vite does, with a context that records warn and error. */
function run(plugin: Plugin, hook: 'buildStart' | 'transformIndexHtml', ...args: unknown[]) {
  const said: { warn: string[] } = { warn: [] };
  const ctx = {
    warn: (m: string) => said.warn.push(m),
    error: (m: string) => {
      throw new Error(m);
    },
  };
  const h = plugin[hook] as unknown as ((...a: unknown[]) => unknown) | { handler: (...a: unknown[]) => unknown };
  const fn = typeof h === 'function' ? h : h.handler;
  return { result: fn.apply(ctx, args), said };
}

describe('the CSP', () => {
  it('is added after the charset of index.html, and the build fails without that tag', () => {
    const html = read('index.html');
    const { result } = run(cspPlugin(), 'transformIndexHtml', html);
    expect(result).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    for (const edited of [html.replace('<meta charset="UTF-8" />', '<meta charset="utf-8">'), html.replace(' />', '>')]) {
      expect(() => run(cspPlugin(), 'transformIndexHtml', edited)).toThrow(/not found in index.html/);
    }
  });

  it('is the same in public/_headers, with frame-ancestors, so the two cannot drift', () => {
    const line = read('public/_headers')
      .split('\n')
      .find((l) => l.trim().startsWith('Content-Security-Policy:'));
    expect(line?.trim()).toBe(`Content-Security-Policy: ${HEADER_CSP}`);
    expect(HEADER_CSP).toBe(`${CSP}; frame-ancestors 'none'`);
  });
});

describe('the pinned engine check', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A checkout with a vendor/ of two files and a list made for them, as the build script writes it. */
  function checkout() {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'celari-pin-'));
    mkdirSync(join(dir, 'vendor', 'webzjs-wallet', 'snippets'), { recursive: true });
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'vendor', 'webzjs-wallet', 'webzjs_wallet_bg.wasm'), 'wasm');
    writeFileSync(join(dir, 'vendor', 'webzjs-wallet', 'snippets', 'a.js'), 'js');
    writeFileSync(join(dir, 'vendor', 'B.txt'), 'b');
    const list = vendorList(join(dir, 'vendor'));
    writeFileSync(join(dir, 'scripts', 'webzjs-vendor.sha256'), list);
    return list;
  }

  it('lists vendor/ as sha256sum does, sorted by bytes (LC_ALL=C)', () => {
    const list = checkout();
    // sha256('b'), and './B.txt' sorts before './webzjs-wallet/...' (upper case first in C order).
    expect(list.split('\n')[0]).toBe('3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  ./B.txt');
    expect(list.split('\n').filter(Boolean).map((l) => l.split('  ')[1])).toEqual([
      './B.txt',
      './webzjs-wallet/snippets/a.js',
      './webzjs-wallet/webzjs_wallet_bg.wasm',
    ]);
  });

  it('builds with the pinned vendor/, and refuses a changed wasm or an extra file', () => {
    checkout();
    expect(() => run(pinnedEngine(dir, {}), 'buildStart')).not.toThrow();
    writeFileSync(join(dir, 'vendor', 'webzjs-wallet', 'webzjs_wallet_bg.wasm'), 'wasm, changed');
    expect(() => run(pinnedEngine(dir, {}), 'buildStart')).toThrow(/does not match scripts\/webzjs-vendor.sha256/);
    checkout();
    writeFileSync(join(dir, 'vendor', 'extra.js'), '');
    expect(() => run(pinnedEngine(dir, {}), 'buildStart')).toThrow(/not the pinned engine/);
  });

  it('builds anyway with CELARI_UNPINNED_ENGINE=1, and says so', () => {
    checkout();
    writeFileSync(join(dir, 'vendor', 'B.txt'), 'changed');
    const { said } = run(pinnedEngine(dir, { CELARI_UNPINNED_ENGINE: '1' }), 'buildStart');
    expect(said.warn.join()).toMatch(/do not deploy this dist/);
  });
});
