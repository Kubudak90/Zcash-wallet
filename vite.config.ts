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

const vendor = (name: string) =>
  fileURLToPath(new URL(`./vendor/${name}`, import.meta.url));

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), cspPlugin()],
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
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
});
