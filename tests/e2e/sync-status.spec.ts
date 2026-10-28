import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Gizli-Parola-2026';
// The fake engine's chain tip (src/engine/fake.ts).
const TIP = 3_100_000;
const en = (n: number) => n.toLocaleString('en-US');

/** Restores a seed wallet from this month's start and returns its birthday. */
async function restoreFromThisMonth(page: Page, lang: 'en' | 'tr' = 'en'): Promise<number> {
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
  await page.getByLabel(s.month, { exact: true }).fill(new Date().toISOString().slice(0, 7));
  await page.getByRole('button', { name: s.next }).click();
  const start = await page.getByText(s.start).textContent();
  await page.getByLabel(pw.first, { exact: true }).fill(PASSWORD);
  await page.getByLabel(pw.again).fill(PASSWORD);
  await page.getByRole('button', { name: pw.submit }).click();
  return Number(start!.replace(/\D/g, ''));
}

/** Switches on behaviour of the fake engine that WebZjs does not show today. */
async function fakeEngine(page: Page, knobs: { midPassProgress?: boolean; tipAhead?: number }) {
  await page.addInitScript((k) => {
    (window as unknown as { __fakeEngine: typeof k }).__fakeEngine = k;
  }, knobs);
}

test('a restore shows how many blocks are left, then up to date', async ({ page }) => {
  const birthday = await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  // Like WebZjs, the fake engine reports no progress mid-pass: the gap stays as
  // measured before the pass (WebZjs starts at birthday - 1).
  const label = `Syncing · ${en(TIP - (birthday - 1))} blocks left`;
  await expect(status).toHaveText(label);
  await expect(status).toHaveAttribute('data-sync', 'syncing');
  const bar = page.getByRole('progressbar', { name: label });
  await expect(bar).toHaveClass('progress indeterminate');
  await expect(bar).not.toHaveAttribute('aria-valuenow');
  await expect(page.getByText('Sync in progress.')).toBeVisible();

  await expect(status).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText('Sync in progress.')).toHaveCount(0);
});

test('an up-to-date wallet does not flicker during the 30 s re-sync', async ({ page }) => {
  test.slow();
  await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-sync', 'idle', { timeout: 20_000 });
  // Record every text and state the pill takes, however briefly.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="sync-status"]')!;
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => seen.push(`${el.getAttribute('data-sync')}|${el.textContent}`)).observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  await page.waitForTimeout(33_000);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.some((s) => s.startsWith('syncing|')), 'a re-sync pass ran').toBe(true);
  for (const s of seen) expect(s).toMatch(new RegExp(`\\|Up to date · block ${en(TIP)}$`));
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('an engine that reports progress mid-pass fills the bar and counts down', async ({ page }) => {
  await fakeEngine(page, { midPassProgress: true });
  const birthday = await restoreFromThisMonth(page);
  const gap = TIP - (birthday - 1);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(`Syncing · ${en(gap)} blocks left`);

  const read = () =>
    page.evaluate(() => {
      const bar = document.querySelector('[role="progressbar"]');
      return {
        pct: bar?.getAttribute('aria-valuenow') ?? null,
        width: bar?.querySelector('span')?.style.width ?? null,
        className: bar?.className ?? null,
        label: bar?.getAttribute('aria-label') ?? null,
        pill: document.querySelector('[data-testid="sync-status"]')!.textContent!,
      };
    });
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^[1-9]\d?$/, { timeout: 10_000 });
  const first = await read();
  const left = Number(first.pill.replace(/\D/g, ''));
  expect(first.className).toBe('progress');
  expect(first.width).toBe(`${first.pct}%`);
  expect(first.label).toBe(first.pill);
  expect(first.pill).toBe(`Syncing · ${en(left)} blocks left`);
  // Blocks left count down from the scanned height, in step with the bar.
  expect(left).toBeLessThan(gap);
  expect(Math.floor(((gap - left) / gap) * 100)).toBe(Number(first.pct));

  await expect
    .poll(async () => Number((await read()).pill.replace(/\D/g, '') || Infinity), { timeout: 10_000 })
    .toBeLessThan(left);
  await expect(status).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('"Up to date" shows the network tip, not the scanned height', async ({ page }) => {
  // The server answering the tip read is three blocks ahead of where the sync stops.
  await fakeEngine(page, { tipAhead: 3 });
  await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-sync', 'idle', { timeout: 20_000 });
  await expect(status).toHaveText(`Up to date · block ${en(TIP + 3)}`);
});

test('Turkish labels group digits the Turkish way', async ({ page }) => {
  const birthday = await restoreFromThisMonth(page, 'tr');
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(`Eşitleniyor · ${(TIP - (birthday - 1)).toLocaleString('tr-TR')} blok kaldı`);
  await expect(status).toHaveText('Güncel · blok 3.100.000', { timeout: 20_000 });
});

test('with reduced motion the indeterminate bar does not slide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await restoreFromThisMonth(page);
  const fill = page.locator('.progress.indeterminate span');
  await expect(fill).toBeVisible();
  expect(await fill.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
