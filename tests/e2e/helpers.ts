import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { expect, type Page } from '@playwright/test';

import type { FakeKnobs } from '../../src/engine/fake';
import { currentMonth } from '../../src/lib/birthday';

export const PASSWORD = 'Gizli-Parola-2026';
// The fake engine's chain tip (src/engine/fake.ts).
export const TIP = 3_100_000;
export const en = (n: number) => n.toLocaleString('en-US');
// A valid-checksum unified address (example from the WebZjs docs).
export const UA =
  'u18rakpts0de589sx9dkamcjms3apruqqax9k2s6e7zjxx9vv5kc67pks2trg9d3nrgd5acu8w8arzjjuepakjx38dyxl6ahd948w0mhdt9jxqsntan6px3ysz80s04a87pheg2mqvlzpehrgup7568nfd6ez23xd69ley7802dfvplnfn7c07vlyumcnfjul4pvv630ac336rjhjyak5';

/** Goes through onboarding with a fresh phrase and waits for the first sync. */
export async function createWallet(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new wallet' }).click();
  await page.getByRole('button', { name: 'Reveal words' }).click();
  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
  expect(words).toHaveLength(24);
  await page.getByLabel('I wrote the words down in order').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await fillVerification(page, words);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();
  // "Scanned to block N · behind the network" when the engine is outdated.
  await expect(page.getByTestId('sync-status')).toHaveText(/^Up to date|behind the network$/, { timeout: 20_000 });
  return words;
}

export async function fillVerification(page: Page, words: string[]): Promise<void> {
  for (const label of await page.locator('form .field > span').allTextContents()) {
    const n = Number(label.replace('Word #', ''));
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
}

/**
 * Restores a seed wallet from this month's start and returns its birthday.
 * Its first pass is a catch-up of thousands of blocks, like a real restore.
 */
export async function restoreFromThisMonth(page: Page, lang: 'en' | 'tr' = 'en'): Promise<number> {
  const s =
    lang === 'en'
      ? { restore: 'Restore an existing wallet', next: 'Continue', month: 'Month', start: /Sync will start at block/ }
      : { restore: 'Var olan cüzdanı geri yükle', next: 'Devam', month: 'Ay', start: /bloktan başlayacak/ };
  const pw =
    lang === 'en'
      ? { first: 'Password', again: 'Password (again)', submit: 'Create wallet' }
      : { first: 'Şifre', again: 'Şifre (tekrar)', submit: 'Cüzdanı oluştur' };

  await page.goto('/');
  if (lang === 'tr') await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: s.restore }).click();
  await page.getByRole('textbox').fill(generateMnemonic(wordlist, 256));
  await page.getByRole('button', { name: s.next }).click();
  // The local month, as the app checks it: the UTC one is a month ahead west of UTC at a month's end.
  await page.getByLabel(s.month, { exact: true }).fill(currentMonth());
  await page.getByRole('button', { name: s.next }).click();
  const start = await page.getByText(s.start).textContent();
  await page.getByLabel(pw.first, { exact: true }).fill(PASSWORD);
  await page.getByLabel(pw.again).fill(PASSWORD);
  await page.getByRole('button', { name: pw.submit }).click();
  return Number(start!.replace(/\D/g, ''));
}

/** Switches on behaviour of the fake engine that WebZjs does not show today; applies again after every reload. */
export async function fakeEngine(page: Page, knobs: FakeKnobs): Promise<void> {
  await page.addInitScript((k) => {
    (window as unknown as { __fakeEngine: typeof k }).__fakeEngine = k;
  }, knobs);
}

/** Changes the fake engine's knobs in the running page. */
export async function setKnobs(page: Page, patch: FakeKnobs): Promise<void> {
  await page.evaluate((p) => {
    const w = window as unknown as { __fakeEngine?: FakeKnobs };
    w.__fakeEngine = { ...w.__fakeEngine, ...p };
  }, patch);
}

/** Puts the tab in the background (or back), as far as the page can tell. */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** The page's window once installContrast has run. */
export type ContrastWindow = Window & {
  /** WCAG contrast of an element's colour property against what is behind it. */
  contrastOf(el: Element, prop?: string, pseudo?: string): number;
};

/** Page init script (page.addInitScript) that defines window.contrastOf. */
export function installContrast(): void {
  // rgb()/rgba() use 0-255; color(srgb ...), which color-mix() computes to, uses 0-1.
  const parse = (c: string): number[] => {
    const n = (c.match(/[\d.]+/g) ?? []).map(Number);
    const k = c.startsWith('color(') ? 255 : 1;
    return [n[0]! * k, n[1]! * k, n[2]! * k, n[3] ?? 1];
  };
  const over = ([r, g, b, a]: number[], under: number[]) => [
    r! * a! + under[0]! * (1 - a!),
    g! * a! + under[1]! * (1 - a!),
    b! * a! + under[2]! * (1 - a!),
  ];
  // Composites the element's and its ancestors' background colours over white.
  const backdrop = (el: Element | null) => {
    const layers: number[][] = [];
    for (let e = el; e; e = e.parentElement) layers.push(parse(getComputedStyle(e).backgroundColor));
    return layers.reverse().reduce((under, layer) => over(layer, under), [255, 255, 255]);
  };
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  (window as unknown as ContrastWindow).contrastOf = (el, prop = 'color', pseudo) => {
    // Text and pseudo-element marks sit on the element; borders and outlines on what is around it.
    const bg = backdrop(prop === 'color' || pseudo ? el : el.parentElement);
    const fg = over(parse(getComputedStyle(el, pseudo).getPropertyValue(prop)), bg);
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (hi! + 0.05) / (lo! + 0.05);
  };
}
