// Vite plugins for the WebZjs wasm packages in vendor/ (built by scripts/build-webzjs.sh).
// Kept apart from vite.config.ts so tests/unit/vite-webzjs.test.ts can run them.

import type { Plugin } from 'vite';

// Inside a worker WebZjs never starts another one: wasm_thread hands spawn
// requests to the main thread and rayon's pool is built there too. Vite still
// bundles every `new Worker(new URL(..., import.meta.url))` it finds, and since
// the rayon and wasm_thread workers reach each other through the wasm glue it
// rejects the build as a circular worker import. In worker bundles every
// `new URL('./…', import.meta.url)` in these snippets becomes a throw, so an
// unexpected nested spawn fails loudly. The snippets are found by wasm-bindgen's
// directory layout (`snippets/<crate>-<16 hex digits>/`), not by where vendor/
// lives or what it is called: Vite resolves a symlinked vendor/ to its target.
const SNIPPET = /\/snippets\/[\w.-]+-[0-9a-f]{16}\//;

export function webzjsNestedWorkers(): Plugin {
  return {
    name: 'celari-webzjs-nested-workers',
    enforce: 'pre',
    transform(code, id) {
      if (!SNIPPET.test(id.split('?')[0]!)) return null;
      return code.replace(
        /new URL\(\s*(['"])(\.\/[^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
        (_match, _quote, file: string) =>
          `(() => { throw new Error(${JSON.stringify(`WebZjs tried to start ${file} inside a worker`)}); })()`,
      );
    },
  };
}

// The CSP has no 'unsafe-eval', yet wasm_thread calls js_sys::eval with two
// fixed snippets: "self" (to tell a worker from the main thread) and one that
// reads the glue script's URL off a stack trace. The glue's eval import is
// swapped for a function that answers exactly those and otherwise throws
// EvalError, as the CSP would. A new snippet sent from Rust goes through the
// same import, so it only fails at runtime, with the snippet in the error message.
//
// Nothing here depends on where vendor/ lives or how its files are named, so a
// silent skip is not possible:
// - every module that is wasm-bindgen glue (by its content) is patched, and any
//   eval call left in it fails the build;
// - every chunk the build writes is checked, and any eval call in it fails the
//   build, whatever module it came from.
const EVAL_CALL = 'eval(getStringFromWasm0(arg0, arg1))';
/** A direct or indirect eval call: `eval(`, `.eval(`, `(0, eval)(`. */
const EVAL_USE = /\beval\s*\(|\(\s*0\s*,\s*eval\s*\)/;
// No eval call in here either, not even inside a string, so the bundle check stays exact.
const EVAL_STANDIN = `
function webzjsEval(src) {
  if (src === 'self') return self;
  if (src.includes('.stack.match(')) return import.meta.url;
  throw new EvalError('js_sys::eval is disabled by the Content-Security-Policy: ' + src.slice(0, 80));
}
`;

/** wasm-bindgen's JS glue: it reads strings out of wasm memory with this helper and names its imports __wbg_*. */
export function isWasmBindgenGlue(code: string): boolean {
  return code.includes('function getStringFromWasm0(') && code.includes('__wbg_');
}

export function webzjsNoEval(): Plugin {
  return {
    name: 'celari-webzjs-no-eval',
    enforce: 'pre',
    transform(code, id) {
      if (!isWasmBindgenGlue(code)) return null;
      const patched = code.replaceAll(EVAL_CALL, 'webzjsEval(getStringFromWasm0(arg0, arg1))');
      if (EVAL_USE.test(patched)) {
        this.error(`the wasm-bindgen glue ${id} calls eval() in a way vite.webzjs.ts does not patch; the CSP would block it`);
      }
      return patched === code ? null : patched + EVAL_STANDIN;
    },
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk' && EVAL_USE.test(output.code)) {
          this.error(`${fileName} calls eval(), which the Content-Security-Policy blocks (see vite.webzjs.ts)`);
        }
      }
    },
  };
}
