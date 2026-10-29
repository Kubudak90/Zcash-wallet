import { expect, test } from '@playwright/test';

import type { FakeKnobs } from '../../src/engine/fake';
import { PASSWORD, TIP, UA, createWallet, en, fakeEngine, restoreFromThisMonth, setKnobs } from './helpers';

test('a restore shows how many blocks are left, then up to date', async ({ page }) => {
  const birthday = await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  // Like WebZjs without its pass counters, the fake engine reports no progress
  // mid-pass: the gap stays as measured before the pass (WebZjs starts at birthday - 1).
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

test('a restore shows how many blocks are left with an engine that has a summary before its first pass', async ({ page }) => {
  // The fake, like the ported WebZjs (zcash_client_sqlite rules), answers no summary until a
  // pass has set the chain tip (the test above); the engine that stopped at NU6.1 answered one
  // at birthday - 1 from the start. Both give the same gap.
  await fakeEngine(page, { summaryBeforePass: true });
  const birthday = await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(`Syncing · ${en(TIP - (birthday - 1))} blocks left`);
  await expect(status).toHaveAttribute('data-sync', 'syncing');
  await expect(status).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
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

test('pass counters move the bar while the summary waits for the pass', async ({ page }) => {
  // Like WebZjs with patches/webzjs/0001-sync-progress.patch: summary() only
  // answers once the pass ends, syncProgress() answers at once.
  await fakeEngine(page, { passCounters: true });
  const birthday = await restoreFromThisMonth(page);
  const gap = TIP - (birthday - 1);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(`Syncing · ${en(gap)} blocks left`);
  // Record every state of the bar and the pill until the pass ends.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const record = () => {
      const bar = document.querySelector('[role="progressbar"]');
      const pill = document.querySelector('[data-testid="sync-status"]')!.textContent!;
      seen.push(`${bar?.getAttribute('aria-valuenow') ?? ''}|${bar?.querySelector('span')?.style.width ?? ''}|${pill}`);
    };
    record();
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await expect(status).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });

  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  const counting = seen
    .map((s) => s.split('|') as [string, string, string])
    .filter(([pct]) => pct !== '')
    .map(([pct, width, pill]) => ({ pct: Number(pct), width, pill, left: Number(pill.replace(/\D/g, '')) }));
  // 0% when the counters first answer, then at least two steps up, never 100%.
  const pcts = [...new Set(counting.map((c) => c.pct))];
  expect(pcts[0]).toBe(0);
  expect(pcts.filter((p) => p > 0).length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < counting.length; i++) {
    expect(counting[i]!.pct).toBeGreaterThanOrEqual(counting[i - 1]!.pct);
    expect(counting[i]!.left).toBeLessThanOrEqual(counting[i - 1]!.left);
  }
  for (const c of counting) {
    expect(c.pct).toBeLessThanOrEqual(99);
    expect(c.width).toBe(`${c.pct}%`);
    expect(c.pill).toBe(`Syncing · ${en(c.left)} blocks left`);
    // The count and the bar agree: a percentage of the measured gap.
    expect(Math.floor(((gap - c.left) / gap) * 100)).toBe(c.pct);
  }
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('a restore over several budgeted passes counts down without jumping back, and goes on at once', async ({ page }) => {
  test.slow();
  // Like the ported WebZjs (final review E2E-1): the newest blocks are scanned first, so the
  // fully scanned height stays at the birthday - 1 until the last batch, and a pass ends at
  // its time budget with blocks left. The count must come from the engine's scan queue.
  const batch = 1_250;
  await fakeEngine(page, { budgetedPasses: { passBlocks: 4 * batch, batchBlocks: batch } });
  const birthday = await restoreFromThisMonth(page);
  const gap = TIP - (birthday - 1);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(`Syncing · ${en(gap)} blocks left`);
  // Every state the pill takes, however briefly, until the wallet is up to date.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="sync-status"]')!;
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const record = () => {
      const entry = `${el.getAttribute('data-sync')}|${el.textContent}`;
      if (seen.at(-1) !== entry) seen.push(entry);
    };
    record();
    new MutationObserver(record).observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const passesRun = () =>
    page.evaluate(() => (window as unknown as { __fakeEngine: FakeKnobs }).__fakeEngine.budgetedPasses?.passesRun ?? 0);
  // Seven blocks are mined once the first pass is over: the count may rise by that much.
  await expect.poll(passesRun).toBeGreaterThanOrEqual(1);
  const growth = 7;
  await setKnobs(page, { chainGrowth: growth });
  await expect(status).toHaveText(`Up to date · block ${en(TIP + growth)}`, { timeout: 120_000 });
  expect(await passesRun()).toBeGreaterThanOrEqual(3);

  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  const syncing = seen.filter((s) => !s.includes('|Up to date'));
  const counts = syncing.map((s) => {
    const m = /^syncing\|Syncing · ([\d,]+) blocks left$/.exec(s);
    expect(m, `a syncing label while the restore runs: ${s}`).not.toBeNull();
    return Number(m![1]!.replace(/,/g, ''));
  });
  expect(counts[0]).toBe(gap);
  let rises = 0;
  for (let i = 1; i < counts.length; i++) {
    const rise = counts[i]! - counts[i - 1]!;
    expect(rise, `${counts[i - 1]} -> ${counts[i]}`).toBeLessThanOrEqual(growth);
    if (rise > 0) rises += rise;
  }
  expect(rises).toBeLessThanOrEqual(growth);
  // It ends below one batch, not with most of the range still "left".
  expect(counts.at(-1)!).toBeLessThanOrEqual(batch);
  // And the count did move down in steps across the passes.
  expect(new Set(counts).size).toBeGreaterThanOrEqual(6);
});

test('"Up to date" shows the network tip, not the scanned height', async ({ page }) => {
  // The server answering the tip read is three blocks ahead of where the sync stops.
  await fakeEngine(page, { tipAhead: 3 });
  await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-sync', 'idle', { timeout: 20_000 });
  await expect(status).toHaveText(`Up to date · block ${en(TIP + 3)}`);
});

test('blocks mined during a long pass are caught up at once, and spends wait for them', async ({ page }) => {
  await page.clock.install();
  await createWallet(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-sync', 'idle');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  const send = page.locator('form').getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();

  // The next pass catches up 50 blocks and runs long; 60 more are mined meanwhile.
  await setKnobs(page, { chainGrowth: 50, holdPass: true });
  await page.clock.fastForward(30_000);
  await expect(status).toHaveText('Syncing · 50 blocks left');
  await expect(send).toBeDisabled();
  await setKnobs(page, { chainGrowth: 110 });
  // Record every state the pill and the Send button take, however briefly.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const record = () => {
      const pill = document.querySelector('[data-testid="sync-status"]')!.textContent!;
      const button = [...document.querySelectorAll('form button')].find((b) => b.textContent === 'Send');
      const entry = `${pill}|${(button as HTMLButtonElement | undefined)?.disabled ? 'waits' : 'can send'}`;
      if (seen.at(-1) !== entry) seen.push(entry);
    };
    record();
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await setKnobs(page, { holdPass: false });

  // The follow-up pass starts at once, not after the 30 s interval.
  await expect(status).toHaveText(`Up to date · block ${en(TIP + 110)}`, { timeout: 5_000 });
  await expect(send).toBeEnabled();
  // On the way the wallet was never up to date at the tip the pass started
  // with, and the send waited until it really was.
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen[0]).toBe('Syncing · 50 blocks left|waits');
  expect(seen).toContain('Syncing · 60 blocks left|waits');
  expect(seen.at(-1)).toBe(`Up to date · block ${en(TIP + 110)}|can send`);
  for (const s of seen.slice(0, -1)) expect(s).toMatch(/^Syncing · \d+ blocks left\|waits$/);
});

test('Turkish labels group digits the Turkish way', async ({ page }) => {
  const birthday = await restoreFromThisMonth(page, 'tr');
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(`Eşitleniyor · ${(TIP - (birthday - 1)).toLocaleString('tr-TR')} blok kaldı`);
  await expect(status).toHaveText(`Güncel · blok ${TIP.toLocaleString('tr-TR')}`, { timeout: 20_000 });
});

test('with reduced motion the indeterminate bar does not slide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await restoreFromThisMonth(page);
  const fill = page.locator('.progress.indeterminate span');
  await expect(fill).toBeVisible();
  expect(await fill.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
