// The production build's security checks, kept apart from vite.config.ts so
// tests/unit/vite-security.test.ts can run them: the Content-Security-Policy (a <meta> in
// dist/index.html, the same policy as a header in public/_headers and in `vite preview`),
// and the check that the WebZjs engine in vendor/ is the one scripts/webzjs-vendor.sha256 pins.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

// Production-only CSP. The dev server injects inline scripts (React refresh),
// so the policy is added at build time only.
export const CSP = [
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

/**
 * The policy as a response header (public/_headers, `vite preview`). Under CSP3 a worker
 * started from a same-origin URL takes its policy from its own response, not from the page's
 * <meta>, so without the header WebZjs's workers (the wasm thread pool, and the thread that
 * makes the gRPC-web requests) run with none (review round 7, PLAT-3). frame-ancestors only
 * works in a header.
 */
export const HEADER_CSP = `${CSP}; frame-ancestors 'none'`;

const CHARSET = '<meta charset="UTF-8" />';

/**
 * Adds the CSP <meta> right after the charset. Fails the build when that tag is not there
 * (review round 7, PLAT-2): a plain replace would silently ship a page with no policy after
 * an edit of index.html. `throw`, not this.error: Vite types this hook's `this` as void.
 */
export function cspPlugin(): Plugin {
  return {
    name: 'celari-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const out = html.replace(CHARSET, `${CHARSET}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      if (out === html) throw new Error(`celari-csp: ${CHARSET} not found in index.html; the CSP was not added`);
      return out;
    },
  };
}

/**
 * The list scripts/webzjs-vendor.sha256 holds, computed for `dir` as CI computes it:
 *   (cd vendor && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)
 * Regular files only, named './<path>', sorted by their bytes.
 */
export function vendorList(dir: string): string {
  // Walked by hand: Dirent.parentPath of a recursive readdir needs Node 20.12 or later.
  const walk = (sub: string): string[] =>
    readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((d) => {
      const path = sub ? `${sub}/${d.name}` : d.name;
      if (d.isDirectory()) return walk(path);
      return d.isFile() ? [`./${path}`] : [];
    });
  const files = walk('').sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return files
    .map((f) => `${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}  ${f}\n`)
    .join('');
}

/**
 * Fails `vite build` unless vendor/ is exactly the pinned engine (review round 7, DRIFT-1).
 * scripts/build-webzjs.sh leaves a build that does not match the list in place (CI reports
 * its diff), and a vendor/ left over from before a `git pull` that changed the engine is not
 * rebuilt at all: either way a locally built dist/ would ship a key-handling wasm that is not
 * the reviewed one, with no message. A Vite plugin rather than an npm `prebuild` script,
 * which `npx vite build` and npm's ignore-scripts would skip.
 *
 * CELARI_UNPINNED_ENGINE=1 builds anyway, with a warning: for engine work, and for hosts other
 * than x86_64 Ubuntu 24.04 with clang-18, which by design do not reproduce the list.
 */
export function pinnedEngine(root: string, env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: 'celari-pinned-engine',
    apply: 'build',
    buildStart() {
      const listFile = join(root, 'scripts', 'webzjs-vendor.sha256');
      let actual: string;
      try {
        actual = vendorList(join(root, 'vendor'));
      } catch (e) {
        this.error(`vendor/ could not be read (${e instanceof Error ? e.message : String(e)}): build it with npm run build:webzjs`);
      }
      if (actual === readFileSync(listFile, 'utf8')) return;
      const message =
        'vendor/ does not match scripts/webzjs-vendor.sha256, so it is not the pinned engine: rebuild it with npm run build:webzjs';
      if (env.CELARI_UNPINNED_ENGINE === '1') {
        this.warn(`${message} (building anyway: CELARI_UNPINNED_ENGINE=1; do not deploy this dist/)`);
        return;
      }
      this.error(`${message}, or set CELARI_UNPINNED_ENGINE=1 for engine work (never for a deployment)`);
    },
  };
}
