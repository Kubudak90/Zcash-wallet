import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HEADER_CSP, cspPlugin, pinnedEngine } from './vite.security';
import { webzjsNestedWorkers, webzjsNoEval } from './vite.webzjs';

// WebZjs uses SharedArrayBuffer for its thread pool, which browsers only allow
// on cross-origin isolated pages.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const vendor = (name: string) =>
  fileURLToPath(new URL(`./vendor/${name}`, import.meta.url));

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  // pinnedEngine first: nothing is built from a vendor/ that is not the pinned engine.
  plugins: [pinnedEngine(fileURLToPath(new URL('.', import.meta.url))), react(), cspPlugin(), webzjsNoEval()],
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
  build: {
    target: 'es2022',
    // Fonts always ship as files: Vite would inline a small one as a data: URL,
    // which the CSP (vite.security.ts: default-src 'self', no font-src) refuses.
    assetsInlineLimit: (file) => (/\.woff2?$/i.test(file) ? false : undefined),
  },
  server: { headers: isolationHeaders },
  // The header CSP too, so `npm run test:e2e:real` runs the engine's workers under it, as
  // public/_headers serves them. Not on the dev server: React refresh needs inline scripts.
  preview: { headers: { ...isolationHeaders, 'Content-Security-Policy': HEADER_CSP } },
});
