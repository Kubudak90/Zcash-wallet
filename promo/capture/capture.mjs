// Captures the real Celari UI (dev server + scripted fake engine, VITE_FAKE_ENGINE=1) as "plates":
// retina screenshots of every step of the tutorial, in Turkish and English, on a desktop and a phone
// viewport, plus the bounding box of every element a scene may point at (cursor, callouts, zoom).
//
//   VITE_FAKE_ENGINE=1 npx vite --port 5199 --strictPort &
//   node promo/capture/capture.mjs [tr|en|all] [desktop|phone|all]
//
// Output: promo/plates/<lang>/<device>/<name>.png and promo/plates/plates.json:
//   { "<lang>.<device>": { "<name>": { file, w, h, scale, targets: { key: {x,y,w,h} } } } }
// All coordinates are CSS pixels of the viewport (w, h); the PNG is w*scale by h*scale.
//
// Nothing here is a real wallet: the fake engine invents addresses and balances. The demo
// recovery phrase is a throwaway BIP39 phrase the fake engine never derives keys from.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { en } from '../../src/i18n/en.ts';
import { tr } from '../../src/i18n/tr.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASE = process.env.CAPTURE_URL ?? 'http://localhost:5199';
const PASSWORD = 'Gizli-Parola-2026';
// A valid-checksum unified address (WebZjs docs example), as the e2e tests use.
const UA =
  'u18rakpts0de589sx9dkamcjms3apruqqax9k2s6e7zjxx9vv5kc67pks2trg9d3nrgd5acu8w8arzjjuepakjx38dyxl6ahd948w0mhdt9jxqsntan6px3ysz80s04a87pheg2mqvlzpehrgup7568nfd6ez23xd69ley7802dfvplnfn7c07vlyumcnfjul4pvv630ac336rjhjyak5';

const MSG = { en, tr };
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 1040 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const VH = Number(process.env.CAPTURE_VH ?? 0);
const MEMO = { tr: 'Kahve için teşekkürler ☕', en: 'Thanks for the coffee ☕' };

const langs = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['tr', 'en'];
const devices = process.argv[3] && process.argv[3] !== 'all' ? [process.argv[3]] : ['desktop', 'phone'];

const manifestPath = join(ROOT, 'plates', 'plates.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

async function run(lang, device) {
  const S = MSG[lang];
  const t = (k, p = {}) => Object.entries(p).reduce((s, [a, b]) => s.replaceAll(`{${a}}`, String(b)), S[k]);
  const dev = { ...DEVICES[device] };
  if (VH && device === 'desktop') dev.viewport = { width: dev.viewport.width, height: VH };
  const outDir = join(ROOT, 'plates', lang, device);
  mkdirSync(outDir, { recursive: true });
  const key = `${lang}.${device}`;
  manifest[key] = {};

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...dev,
    colorScheme: 'dark',
    locale: lang === 'tr' ? 'tr-TR' : 'en-US',
    timezoneId: 'Europe/Istanbul',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror ${key}]`, e.message));

  /** Bounding boxes of the named locators, in viewport CSS px (null when absent). */
  async function boxes(targets) {
    const out = {};
    for (const [k, loc] of Object.entries(targets)) {
      try {
        const l = typeof loc === 'string' ? page.locator(loc).first() : loc.first();
        const b = await l.boundingBox({ timeout: 1500 });
        if (b) out[k] = { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
      } catch {
        /* absent in this state */
      }
    }
    return out;
  }

  async function shot(name, targets = {}, { keepScroll = false } = {}) {
    await page.mouse.move(0, 0);
    if (!keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(450);
    const file = `${lang}/${device}/${name}.png`;
    const tg = await boxes(targets);
    // The wallet's navigation (sidebar on desktop, tab bar on phone) and the lock button, whenever they are on screen.
    if (await navBar.count()) {
      Object.assign(tg, await boxes({
        navHome: nav(S['nav.home']), navReceive: nav(S['nav.receive']), navSend: nav(S['nav.send']),
        navHistory: nav(S['nav.history']), navSettings: nav(S['nav.settings']),
        lock: page.getByRole('button', { name: S['nav.lock'] }).first(),
      }));
    }
    await page.screenshot({ path: join(ROOT, 'plates', file), animations: 'disabled', caret: 'hide' });
    const sh = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    manifest[key][name] = { file, w: dev.viewport.width, h: dev.viewport.height, scale: dev.deviceScaleFactor, docH: sh, scrollY: await page.evaluate(() => Math.round(window.scrollY)), targets: tg };
    console.log(`  ${key} ${name} (${Object.keys(tg).length} targets) docH=${sh}`);
  }

  const btn = (name, exact = true) => page.getByRole('button', { name, exact });
  const nav = (name) => page.getByRole('navigation', { name: 'Celari' }).getByRole('button', { name, exact: true });
  const navBar = page.getByRole('navigation', { name: 'Celari' });
  const syncRe = lang === 'tr' ? /Güncel|ağın gerisinde/ : /Up to date|behind the network/;

  await page.goto(BASE + '/');
  await page.waitForSelector('text=' + S['welcome.eyebrow'], { timeout: 20000 }).catch(() => {});
  if (lang === 'tr') await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.waitForTimeout(600);

  // 1. Welcome
  await shot('welcome', {
    create: btn(S['welcome.create'], false),
    restore: btn(S['welcome.restore'], false),
    language: page.getByRole('button', { name: 'Türkçe' }),
    pillars: page.locator('.welcome-pillars, .pillars').first(),
  });

  // 2. Create: recovery phrase
  await btn(S['welcome.create'], false).click();
  await page.getByRole('button', { name: S['create.reveal'] }).waitFor();
  await shot('create-seed-hidden', { reveal: btn(S['create.reveal']), grid: page.getByTestId('seed-grid') });
  await btn(S['create.reveal']).click();
  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
  await shot('create-seed-revealed', { grid: page.getByTestId('seed-grid'), check: page.getByLabel(S['create.wroteDown']) });
  await page.getByLabel(S['create.wroteDown']).check();
  await shot('create-seed-checked', { check: page.getByLabel(S['create.wroteDown']), next: btn(S['common.continue']) });
  await btn(S['common.continue']).click();

  // 3. Create: verify three words
  await page.getByText(S['create.verifyTitle']).first().waitFor();
  await shot('create-verify', { form: page.locator('form').first(), next: btn(S['common.continue']) });
  for (const label of await page.locator('form .field > span').allTextContents()) {
    const n = Number(label.replace(/\D/g, ''));
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]);
  }
  await shot('create-verify-filled', { form: page.locator('form').first(), next: btn(S['common.continue']) });
  await btn(S['common.continue']).click();

  // 4. Create: password
  await page.getByLabel(S['common.password'], { exact: true }).waitFor();
  await shot('password', {
    pw1: page.getByLabel(S['common.password'], { exact: true }),
    pw2: page.getByLabel(S['password.repeat']),
    submit: btn(S['password.finish']),
  });
  await page.getByLabel(S['common.password'], { exact: true }).fill(PASSWORD);
  await page.getByLabel(S['password.repeat']).fill(PASSWORD);
  await shot('password-filled', {
    pw1: page.getByLabel(S['common.password'], { exact: true }),
    pw2: page.getByLabel(S['password.repeat']),
    submit: btn(S['password.finish']),
  });
  await btn(S['password.finish']).click();

  // 5. Home
  await page.getByTestId('sync-status').waitFor({ timeout: 20000 });
  await page.getByTestId('sync-status').filter({ hasText: syncRe }).waitFor({ timeout: 25000 });
  await page.getByTestId('balance-total').waitFor();
  const homeTargets = {
    total: page.getByTestId('balance-total'),
    shielded: page.getByTestId('balance-shielded'),
    transparent: page.getByTestId('balance-transparent'),
    eye: page.locator('.eye-toggle'),
    notice: page.locator('.notice').first(),
    shieldButton: btn(S['home.shieldButton'], false),
    sync: page.getByTestId('sync-status'),
    nav: navBar,
    privacyCard: page.locator('.privacy-card'),
    recent: page.getByTestId('recent-activity'),
    hero: page.locator('.hero').first(),
  };
  await shot('home', homeTargets);
  await page.locator('.eye-toggle').click();
  await shot('home-hidden', homeTargets);
  await page.locator('.eye-toggle').click();
  await page.waitForTimeout(200);

  // 6. Receive (a fresh address on every opening)
  await nav(S['nav.receive']).click();
  await page.getByTestId('receive-address').waitFor();
  await page.getByTestId('receive-address').filter({ hasText: /^u1/ }).waitFor();
  const receiveTargets = {
    address: page.getByTestId('receive-address'),
    card: page.locator('.card').first(),
    qr: page.locator('canvas, img[alt*="QR"], svg.qr, .qr').first(),
    copy: page.getByRole('button', { name: S['common.copy'] }),
    showTransparent: btn(S['receive.showTransparent']),
    freshNote: page.getByTestId('receive-fresh-note'),
  };
  await shot('receive', receiveTargets);
  const firstAddr = await page.getByTestId('receive-address').textContent();
  await btn(S['receive.showTransparent']).click();
  await page.getByTestId('receive-address').filter({ hasText: /^t1/ }).waitFor();
  await shot('receive-transparent', { ...receiveTargets, showUnified: btn(S['receive.showUnified']) });
  // Away and back: a new shielded address.
  await nav(S['nav.history']).click();
  await page.waitForTimeout(300);
  await nav(S['nav.receive']).click();
  await page.getByTestId('receive-address').filter({ hasText: /^u1/ }).waitFor();
  await page.waitForTimeout(400);
  const secondAddr = await page.getByTestId('receive-address').textContent();
  await shot('receive-second', receiveTargets);
  manifest[key]['receive-second'].note = `first address ${firstAddr?.slice(0, 16)}… vs second ${secondAddr?.slice(0, 16)}…`;

  // 7. Send
  await nav(S['nav.send']).click();
  await page.getByLabel(S['send.to']).waitFor();
  const sendTargets = {
    to: page.getByLabel(S['send.to']),
    amount: page.getByLabel(S['send.amount']),
    memo: page.getByLabel(S['send.memo'], { exact: false }),
    review: btn(S['send.review']),
    max: btn(S['send.max']),
    available: page.getByText(t('send.available', { amount: '' }).split('{')[0].trim(), { exact: false }),
    form: page.locator('form').first(),
  };
  await shot('send-empty', sendTargets);
  await page.getByLabel(S['send.to']).fill(UA);
  await page.getByLabel(S['send.amount']).fill(lang === 'tr' ? '0,5' : '0.5');
  await page.getByLabel(S['send.memo'], { exact: false }).fill(MEMO[lang]);
  await page.waitForTimeout(250);
  await shot('send-filled', sendTargets);
  await btn(S['send.review']).click();
  await page.getByLabel(S['send.confirmPassword']).waitFor();
  const confirmTargets = {
    amount: page.getByTestId('confirm-amount'),
    memo: page.getByTestId('confirm-memo'),
    password: page.getByLabel(S['send.confirmPassword']),
    send: page.locator('form').getByRole('button', { name: S['send.sendNow'], exact: true }),
    form: page.locator('form').first(),
  };
  await shot('send-confirm', confirmTargets);
  await page.getByLabel(S['send.confirmPassword']).fill(PASSWORD);
  await shot('send-confirm-filled', confirmTargets);
  await page.evaluate(() => {
    window.__fakeEngine = { ...(window.__fakeEngine || {}), holdSpend: true };
  });
  await page.locator('form').getByRole('button', { name: S['send.sendNow'], exact: true }).click();
  await page.locator('.stages').waitFor({ timeout: 10000 });
  await shot('send-proving', { stages: page.locator('.stages') });
  await page.evaluate(() => {
    window.__fakeEngine = { ...(window.__fakeEngine || {}), holdSpend: false };
  });
  await page.getByRole('heading', { name: /0[.,]50 ZEC/ }).waitFor({ timeout: 20000 });
  await shot('send-success', { title: page.getByRole('heading', { name: /0[.,]50 ZEC/ }), close: btn(S['common.close']) });

  // 8. Shield the transparent balance
  const closeBtn = page.getByRole('button', { name: S['common.close'], exact: true });
  if (await closeBtn.count()) await closeBtn.first().click();
  await nav(S['nav.home']).click();
  await page.getByTestId('balance-total').waitFor();
  await page.getByRole('button', { name: S['home.shieldButton'], exact: false }).first().waitFor({ timeout: 15000 });
  await shot('home-after-send', homeTargets);
  await page.getByRole('button', { name: S['home.shieldButton'], exact: false }).first().click();
  await page.getByLabel(S['send.confirmPassword']).waitFor();
  const shieldTargets = {
    form: page.locator('form').first(),
    password: page.getByLabel(S['send.confirmPassword']),
    confirm: btn(S['shield.confirm']),
  };
  await shot('shield-confirm', shieldTargets);
  await page.getByLabel(S['send.confirmPassword']).fill(PASSWORD);
  await shot('shield-confirm-filled', shieldTargets);
  await btn(S['shield.confirm']).click();
  await page.getByRole('heading', { name: /ZEC/ }).waitFor({ timeout: 20000 });
  await shot('shield-success', { title: page.getByRole('heading', { name: /ZEC/ }) });
  if (await closeBtn.count()) await closeBtn.first().click();
  await page.waitForTimeout(400);
  await shot('home-final', homeTargets);

  // 9. History
  await nav(S['nav.history']).click();
  await page.getByTestId('history').waitFor();
  await page.waitForTimeout(300);
  await shot('history', {
    list: page.getByTestId('history'),
    firstRow: page.locator('[data-testid="history"] .tx').nth(0),
    secondRow: page.locator('[data-testid="history"] .tx').nth(1),
    thirdRow: page.locator('[data-testid="history"] .tx').nth(2),
    note: page.getByText(S['history.privacyNote'].slice(0, 30), { exact: false }),
  });

  // 10. Settings: general/privacy/security
  await nav(S['nav.settings']).click();
  await page.getByRole('heading', { name: S['settings.title'] }).first().waitFor();
  const settingsTargets = {
    server: page.getByLabel(S['settings.server']),
    autoLock: page.getByLabel(S['settings.autoLock'], { exact: false }),
    historySwitch: page.getByText(S['settings.historyEnhancement'], { exact: false }).first(),
    viewingKey: btn(S['settings.showViewingKey']),
    seed: btn(S['settings.showSeed']),
    language: page.getByRole('button', { name: 'Türkçe' }),
  };
  await shot('settings', settingsTargets);
  await page.evaluate(() => window.scrollTo(0, 560));
  await shot('settings-privacy', settingsTargets, { keepScroll: true });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('settings-bottom', settingsTargets, { keepScroll: true });

  // 11. Lock
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: S['nav.lock'] }).first().click();
  await page.getByRole('heading', { name: S['unlock.title'] }).waitFor();
  await shot('unlock', { password: page.getByLabel(S['common.password']), unlock: btn(S['unlock.button']) });

  await browser.close();
}

for (const lang of langs) for (const device of devices) {
  console.log(`== ${lang} / ${device}`);
  await run(lang, device);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}
console.log('done ->', manifestPath);
