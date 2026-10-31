import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet, fakeEngine, nav, restoreFromThisMonth, setHidden, setKnobs } from './helpers';

// Review round 7 (docs/reviews/2026-10-pre-nu7-core-review.md): a pass or a request that
// never ends (a server or proxy that holds the connection open without answering) must not
// keep the wallet unlocked behind a lock screen, or behind a spend, for ever (VAULT-3, SPEND-4),
// and a steady-state pass that stalls is flagged like a catch-up pass (SYNC-5).

const SOFT_NOTE = /keeps running in the background until its progress is saved/;
const lockScreen = (page: Page) => page.getByRole('heading', { name: 'Your wallet is locked' });

/** Marks the page; a reload drops the mark. */
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { samePage?: boolean }).samePage = true;
  });
const samePage = (page: Page) => page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage === true);

/** A minute at a time, so the 1 s progress poll and the timers run at each step. */
async function minutes(page: Page, n: number) {
  for (let i = 0; i < n; i++) await page.clock.fastForward(60_000);
}

test.describe('a soft lock behind a pass that never ends', () => {
  test('reloads after 15 minutes at the latest', async ({ page }) => {
    await page.clock.install();
    // No pass counters: nothing can tell the pass stalled, only the cap ends the soft lock.
    await fakeEngine(page, { holdPass: true });
    await restoreFromThisMonth(page);
    await expect(page.getByTestId('sync-status')).toHaveText(/^Syncing/);
    await mark(page);
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByText(SOFT_NOTE)).toBeVisible();

    await minutes(page, 14);
    expect(await samePage(page), 'still waiting for the pass').toBe(true);
    await expect(page.getByText(SOFT_NOTE)).toBeVisible();

    await minutes(page, 2);
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toHaveCount(0);
    expect(await samePage(page), 'reloaded').toBe(false);
  });

  test('reloads once the pass is seen to stall', async ({ page }) => {
    await page.clock.install();
    await fakeEngine(page, { holdPass: true, passCounters: true });
    await restoreFromThisMonth(page);
    await expect(page.getByTestId('sync-status')).toHaveText(/^Syncing/);
    await mark(page);
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByText(SOFT_NOTE)).toBeVisible();

    await minutes(page, 9);
    expect(await samePage(page)).toBe(true);
    await minutes(page, 2);
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toHaveCount(0);
    expect(await samePage(page), 'reloaded before the 15-minute cap').toBe(false);
  });

  test('a wrong password while the pass hangs does not undo the cap', async ({ page }) => {
    await page.clock.install();
    await fakeEngine(page, { holdPass: true });
    await restoreFromThisMonth(page);
    await expect(page.getByTestId('sync-status')).toHaveText(/^Syncing/);
    await mark(page);
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByLabel('Password').fill('nope-nope-nope');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('Wrong password.')).toBeVisible();
    await minutes(page, 16);
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toHaveCount(0);
    expect(await samePage(page)).toBe(false);
  });
});

test('a spend that hangs before it is broadcast lets the auto-lock through after 5 minutes', async ({ page }) => {
  await page.clock.install();
  await createWallet(page);
  await nav(page, 'Send');
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  // Like pczt_create waiting for a pass that holds the database and never ends.
  await setKnobs(page, { holdStage: 'building' });
  await mark(page);
  await page.locator('form').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.stages li.current')).toBeVisible();

  // The tab goes to the background: the auto-lock waits for the spend, but not for ever.
  await setHidden(page, true);
  await minutes(page, 5);
  expect(await samePage(page), 'deferred while the spend may still settle').toBe(true);
  await minutes(page, 2);
  await expect(lockScreen(page)).toBeVisible();
  expect(await samePage(page)).toBe(false);

  // Nothing was sent: the spend never got past building.
  await setHidden(page, false);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await nav(page, 'History');
  await expect(page.getByTestId('history').locator('.tx-sent')).toHaveCount(0);
});

test('a steady-state pass whose counters stand still for 10 minutes is flagged', async ({ page }) => {
  await page.clock.install();
  await fakeEngine(page, { passCounters: true });
  await createWallet(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveText(/^Up to date/);
  // The next pass hangs, as when the server stops answering mid-pass.
  await setKnobs(page, { holdPass: true });
  await minutes(page, 5);
  await expect(page.getByTestId('sync-stalled')).toHaveCount(0);
  await minutes(page, 7);
  await expect(page.getByTestId('sync-stalled')).toBeVisible();
  // No catch-up: the pill still reads up to date, and no progress bar shows.
  await expect(status).toHaveText(/^Up to date/);

  await setKnobs(page, { holdPass: false });
  await page.clock.fastForward(30_000);
  await expect(page.getByTestId('sync-stalled')).toHaveCount(0, { timeout: 10_000 });
});
