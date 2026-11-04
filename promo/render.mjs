#!/usr/bin/env node
// Frame-by-frame renderer for Celari video scenes.
//
//   node promo/render.mjs scenes/s01-open --lang tr --stills 0.5,2,4.5 --outdir /tmp/x   # PNG stills + contact sheet
//   node promo/render.mjs scenes/s01-open --lang tr --out out/s01.tr.mp4 [--fps 30] [--workers 3]
//
// A scene is promo/scenes/<id>/index.html that loads /lib/stage.js. The page is served over HTTP from promo/
// (module scripts and fetch need it), loaded at 1920x1080, and for every frame the renderer calls
// window.__seek(t) and takes a screenshot, so a render is a pure function of the scene files.
// Exit code 2 when the page logged an error or a request failed (a missing image, a 404, a script error).

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PROMO = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };

export function startServer(root = PROMO) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

function args() {
  const a = process.argv.slice(2);
  const o = { scene: null, lang: 'tr', fps: 30, workers: 3, stills: null, outdir: null, out: null, duration: null, crf: 15, tmp: process.env.PROMO_TMP ?? join(tmpdir(), 'celari-promo'), keep: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (!k.startsWith('--')) o.scene = k;
    else if (k === '--keep') o.keep = true;
    else {
      const v = a[++i];
      if (k === '--lang') o.lang = v;
      else if (k === '--fps') o.fps = Number(v);
      else if (k === '--workers') o.workers = Number(v);
      else if (k === '--stills') o.stills = v.split(',').map(Number);
      else if (k === '--outdir') o.outdir = resolve(v);
      else if (k === '--out') o.out = resolve(v);
      else if (k === '--duration') o.duration = Number(v);
      else if (k === '--crf') o.crf = Number(v);
      else if (k === '--tmp') o.tmp = resolve(v);
      else throw new Error(`unknown option ${k}`);
    }
  }
  if (!o.scene) throw new Error('usage: render.mjs <scene dir> --lang tr|en (--stills t1,t2 --outdir dir | --out file.mp4)');
  return o;
}

export async function renderScene(o) {
  const sceneDir = o.scene.replace(/^promo\//, '').replace(/\/$/, '').replace(/\/index\.html$/, '');
  const id = basename(sceneDir);
  if (!existsSync(join(PROMO, sceneDir, 'index.html'))) throw new Error(`no ${sceneDir}/index.html under promo/`);
  const { server, port } = await startServer();
  const browsers = [];
  const problems = [];
  // One browser PROCESS per worker: pages of a single browser share one compositor/raster process and do not scale.
  const open = async () => {
    const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
    browsers.push(browser);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
    page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
    await page.goto(`http://127.0.0.1:${port}/${sceneDir}/index.html?lang=${o.lang}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
    page.cdp = await ctx.newCDPSession(page);
    return page;
  };
  try {
    const first = await open();
    const duration = o.duration ?? (await first.evaluate('window.__duration'));
    if (o.stills) {
      mkdirSync(o.outdir, { recursive: true });
      const files = [];
      for (const t of o.stills) {
        await first.evaluate((x) => window.__seek(x), t);
        await first.waitForTimeout(60);
        const f = join(o.outdir, `${id}.${o.lang}.t${t.toFixed(2).padStart(5, '0')}.png`);
        await first.screenshot({ path: f });
        files.push(f);
      }
      const sheet = join(o.outdir, `${id}.${o.lang}.sheet.png`);
      spawnSync('python3', ['-I', join(PROMO, 'lib', 'sheet.py'), sheet, ...files], { stdio: 'inherit' });
      console.log(`scene ${id} (${duration}s) stills:\n  ${files.join('\n  ')}\n  contact sheet: ${sheet}`);
    } else {
      const n = Math.round(duration * o.fps);
      const dir = join(o.tmp, `${id}.${o.lang}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const pages = [first];
      for (let w = 1; w < o.workers; w++) pages.push(await open());
      let done = 0;
      const t0 = Date.now();
      await Promise.all(pages.map(async (page, w) => {
        for (let i = w; i < n; i += pages.length) {
          await page.evaluate((x) => window.__seek(x), i / o.fps);
          // CDP with optimizeForSpeed: ~3x faster than page.screenshot (the PNGs are only an intermediate)
          const { data } = await page.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
          writeFileSync(join(dir, `${String(i).padStart(5, '0')}.png`), Buffer.from(data, 'base64'));
          if (++done % 60 === 0) process.stdout.write(`\r  ${id}.${o.lang}: ${done}/${n} frames (${((done / ((Date.now() - t0) / 1000)) | 0)} fps)   `);
        }
      }));
      process.stdout.write('\n');
      mkdirSync(dirname(o.out), { recursive: true });
      const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(o.fps), '-i', join(dir, '%05d.png'),
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf ?? 15), '-profile:v', 'high', '-x264-params', 'aq-mode=3:aq-strength=0.9',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', o.out], { stdio: 'inherit' });
      if (ff.status !== 0) throw new Error('ffmpeg failed');
      if (!o.keep) rmSync(dir, { recursive: true, force: true });
      console.log(`wrote ${o.out} (${n} frames, ${duration}s)`);
    }
  } finally {
    await Promise.all(browsers.map((b) => b.close()));
    server.close();
  }
  const uniq = [...new Set(problems)];
  if (uniq.length) {
    console.log('PROBLEMS:\n  ' + uniq.join('\n  '));
    return 2;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderScene(args()).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
