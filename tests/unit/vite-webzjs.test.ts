import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';

import { webzjsNestedWorkers, webzjsNoEval } from '../../vite.webzjs';

// The production CSP has no 'unsafe-eval'. wasm_thread calls js_sys::eval through the
// wasm-bindgen glue, and vite.webzjs.ts swaps that call for a stand-in. These tests run the
// plugins the way Vite does, on glue in places and under names the old path match missed.

/** The shape of wasm-bindgen 0.2.129's glue around its eval import (vendor/webzjs-wallet/webzjs_wallet.js). */
const GLUE = `
let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_eval_6d3f44b1(arg0, arg1) {
            const ret = eval(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_log_0c8a71ce(arg0) { console.log(getObject(arg0)); },
    };
    return { './webzjs_wallet_bg.js': import0 };
}
`;

type Ctx = { error(message: string): never };
const ctx: Ctx = {
  error(message: string): never {
    throw new Error(message);
  },
};

function transform(plugin: Plugin, code: string, id: string): string | null {
  const hook = plugin.transform as unknown as (this: Ctx, code: string, id: string) => string | null | undefined;
  return hook.call(ctx, code, id) ?? null;
}

function generateBundle(plugin: Plugin, chunks: Record<string, string>): void {
  const hook = plugin.generateBundle as unknown as ((this: Ctx, options: unknown, bundle: unknown) => void) | undefined;
  if (!hook) throw new Error('the plugin does not check the bundle');
  const bundle = Object.fromEntries(
    Object.entries(chunks).map(([fileName, code]) => [fileName, { type: 'chunk', fileName, code }]),
  );
  hook.call(ctx, {}, bundle);
}

const EVAL_CALL = /\beval\s*\(/;

describe('webzjsNoEval', () => {
  for (const id of [
    '/w/app/vendor/webzjs-wallet/webzjs_wallet.js',
    // vendor/ a symlink to a directory with another name: Vite resolves symlinks.
    '/w/engine-port/vendor-r2/webzjs-wallet/webzjs_wallet.js',
    '/w/app/vendor/webzjs-wallet-v2/webzjs_wallet.js',
    // wasm-pack --out-name, or a package under node_modules.
    '/w/app/vendor/webzjs-wallet/webzjs_wallet2.js',
    '/w/app/node_modules/@chainsafe/webzjs-wallet/webzjs_wallet.js?v=1',
  ]) {
    it(`patches the glue at ${id}`, () => {
      const out = transform(webzjsNoEval(), GLUE, id);
      expect(out, 'the glue was patched').not.toBeNull();
      expect(out).not.toMatch(EVAL_CALL);
      expect(out).toContain('webzjsEval(getStringFromWasm0(arg0, arg1))');
      expect(out).toContain('function webzjsEval(src)');
    });
  }

  it('fails the build when the glue calls eval in a way it cannot patch', () => {
    const changed = GLUE.replace('eval(getStringFromWasm0(arg0, arg1))', 'eval(getStringFromWasm0(arg0, arg1 >>> 0))');
    expect(() => transform(webzjsNoEval(), changed, '/w/app/vendor-old/webzjs-wallet/webzjs_wallet.js')).toThrow(
      /eval/,
    );
  });

  it('leaves modules that are not wasm-bindgen glue alone', () => {
    expect(transform(webzjsNoEval(), 'export const evaluate = (x) => x;', '/w/app/src/lib/zec.ts')).toBeNull();
  });

  it('fails the build when a bundle still calls eval, however the glue was missed', () => {
    const plugin = webzjsNoEval();
    expect(() => generateBundle(plugin, { 'assets/webzjs_wallet-x.js': 'const r=eval(Te(e,t));' })).toThrow(
      /webzjs_wallet-x\.js/,
    );
    expect(() => generateBundle(plugin, { 'assets/a.js': 'const r=(0,eval)(s);' })).toThrow(/a\.js/);
    expect(() => generateBundle(plugin, { 'assets/a.js': 'const r=globalThis.eval(s);' })).toThrow(/a\.js/);
  });

  it('passes a bundle made of the patched glue', () => {
    const patched = transform(webzjsNoEval(), GLUE, '/w/app/vendor/webzjs-wallet/webzjs_wallet.js')!;
    expect(() => generateBundle(webzjsNoEval(), { 'assets/webzjs_wallet-x.js': patched })).not.toThrow();
  });

  // The real glue, when vendor/ is built (scripts/build-webzjs.sh); CI's app job has none.
  const real = new URL('../../vendor/webzjs-wallet/webzjs_wallet.js', import.meta.url);
  it.skipIf(!existsSync(real))('patches the glue in vendor/, and the result passes the bundle check', () => {
    const code = readFileSync(real, 'utf8');
    expect(code).toMatch(EVAL_CALL);
    const out = transform(webzjsNoEval(), code, '/w/elsewhere/webzjs_wallet.js')!;
    expect(out).not.toMatch(EVAL_CALL);
    expect(() => generateBundle(webzjsNoEval(), { 'assets/webzjs_wallet.js': out })).not.toThrow();
  });
});

describe('webzjsNestedWorkers', () => {
  const START = `const w = new Worker(\n    new URL('./web_worker_module.bundler.js', import.meta.url),\n    { type: 'module' });`;
  for (const id of [
    '/w/app/vendor/webzjs-wallet/snippets/wasm_thread-8ee53d0673203880/src/wasm32/js/module_worker_start.js',
    '/w/engine-port/vendor-old/webzjs-wallet/snippets/wasm_thread-8ee53d0673203880/src/wasm32/js/module_worker_start.js',
    '/w/app/vendor/webzjs-wallet-v2/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js',
  ]) {
    it(`turns a nested worker spawn into a throw at ${id}`, () => {
      const out = transform(webzjsNestedWorkers(), START, id);
      expect(out).not.toBeNull();
      expect(out).not.toContain('new URL(');
      expect(out).toContain('WebZjs tried to start ./web_worker_module.bundler.js inside a worker');
    });
  }

  it('leaves other modules alone', () => {
    expect(transform(webzjsNestedWorkers(), START, '/w/app/src/worker.ts')).toBeNull();
  });
});
