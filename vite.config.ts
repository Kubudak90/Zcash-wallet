import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// WebZjs uses SharedArrayBuffer for its thread pool, which browsers only allow
// on cross-origin isolated pages.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Production-only CSP. The dev server injects inline scripts (React refresh),
// so the policy is added at build time only.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // lightwalletd proxies are user-configurable, so any https origin is allowed.
  "connect-src 'self' https:",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'celari-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// Inside a worker WebZjs never starts another one: wasm_thread hands spawn
// requests to the main thread and rayon's pool is built there too. Vite still
// bundles every `new Worker(new URL(..., import.meta.url))` it finds, and since
// the rayon and wasm_thread workers reach each other through the wasm glue it
// rejects the build as a circular worker import. In worker bundles every
// `new URL('./…', import.meta.url)` in these snippets becomes a throw, so an
// unexpected nested spawn fails loudly.
function webzjsNestedWorkers(): Plugin {
  return {
    name: 'celari-webzjs-nested-workers',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/vendor/webzjs-wallet/snippets/')) return null;
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
// EvalError, as the CSP would. Any other eval() in the glue fails the build; a
// new snippet sent from Rust goes through the same import, so it only fails at
// runtime, with the snippet in the error message.
const EVAL_CALL = 'eval(getStringFromWasm0(arg0, arg1))';
const EVAL_STANDIN = `
function webzjsEval(src) {
  if (src === 'self') return self;
  if (src.includes('.stack.match(')) return import.meta.url;
  throw new EvalError('eval() is disabled by the Content-Security-Policy: ' + src.slice(0, 80));
}
`;

function webzjsNoEval(): Plugin {
  return {
    name: 'celari-webzjs-no-eval',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/vendor\/webzjs-[a-z]+\/webzjs_[a-z]+\.js$/.test(id.split('?')[0]!)) return null;
      const patched = code.replaceAll(EVAL_CALL, 'webzjsEval(getStringFromWasm0(arg0, arg1))');
      if (/\beval\(/.test(patched)) this.error(`unexpected eval() in ${id}`);
      return patched === code ? null : patched + EVAL_STANDIN;
    },
  };
}

const vendor = (name: string) =>
  fileURLToPath(new URL(`./vendor/${name}`, import.meta.url));

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), cspPlugin(), webzjsNoEval()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@chainsafe/webzjs-wallet': vendor('webzjs-wallet'),
      '@chainsafe/webzjs-keys': vendor('webzjs-keys'),
    },
  },
  // The wasm packages spawn their own module workers via
  // `new Worker(new URL(..., import.meta.url))`; pre-bundling breaks those URLs.
  optimizeDeps: {
    exclude: ['@chainsafe/webzjs-wallet', '@chainsafe/webzjs-keys'],
  },
  worker: { format: 'es', plugins: () => [webzjsNestedWorkers(), webzjsNoEval()] },
  build: { target: 'es2022' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
});
