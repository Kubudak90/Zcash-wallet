import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, TIP, UA, createWallet, en, fakeEngine, nav, restoreFromThisMonth, setHidden, setKnobs } from './helpers';

// The wallet locks itself when its tab stays in the background, and a lock
// that comes during a catch-up pass (a restore) keeps that pass's progress.

const HIDDEN_NOTICE = 'Locked automatically because this tab was in the background for 1 minute.';
const IDLE_NOTICE = 'Locked automatically after 15 minutes of inactivity.';
const SOFT_NOTE = /keeps running in the background until its progress is saved/;

const lockScreen = (page: Page) => page.getByRole('heading', { name: 'Your wallet is locked' });
const nowInPage = (page: Page) => page.evaluate(() => Date.now());

async function unlock(page: Page, password = PASSWORD) {
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** Marks the page; a reload drops the mark. */
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { samePage?: boolean }).samePage = true;
  });
const samePage = (page: Page) => page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage === true);

test.describe('tab in the background', () => {
  test('locks after a minute, also across a sleep, and says why', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);

    // 50 s in the background is fine, and coming back starts the minute over.
    await setHidden(page, true);
    await page.clock.fastForward(50_000);
    await setHidden(page, false);
    await page.clock.fastForward(20_000);
    await setHidden(page, true);
    await page.clock.fastForward(50_000);
    await expect(page.getByTestId('balance-total')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('celari.autoLocked'))).toBeNull();

    await page.clock.fastForward(10_000);
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(HIDDEN_NOTICE)).toBeVisible();

    // Asleep in the background overnight: the timers stood still, the wall clock did not.
    await unlock(page);
    await expect(page.getByTestId('balance-total')).toBeVisible();
    await setHidden(page, true);
    await page.clock.setSystemTime((await nowInPage(page)) + 8 * 3600_000);
    await setHidden(page, false);
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(HIDDEN_NOTICE)).toBeVisible();
  });

  test('a running send finishes before the lock', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    await nav(page, 'Send');
    await page.getByLabel('Recipient address').fill(UA);
    await page.getByLabel('Amount (ZEC)').fill('0.1');
    await page.getByRole('button', { name: 'Review' }).click();
    await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
    await setKnobs(page, { holdSpend: true });
    await mark(page);
    await page.locator('form').getByRole('button', { name: 'Send', exact: true }).click();
    const current = page.locator('.stages li.current');
    await expect(current).toContainText('Generating zero-knowledge proofs');

    await setHidden(page, true);
    await page.clock.fastForward(2 * 60_000);
    await setHidden(page, false);
    // Still on the payment's progress: a reload now would cut it off.
    await expect(current).toContainText('Generating zero-knowledge proofs');
    expect(await samePage(page)).toBe(true);

    await setKnobs(page, { holdSpend: false });
    await expect(lockScreen(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(HIDDEN_NOTICE)).toBeVisible();
    // The payment went out before the lock.
    await unlock(page);
    await nav(page, 'History');
    await expect(page.getByTestId('history').locator('.tx-sent')).toHaveCount(1);
  });
});

test.describe('a lock during a restore', () => {
  // Every pass waits until released, after every reload too.
  test.beforeEach(({ page }) => fakeEngine(page, { holdPass: true }));

  test('shows the lock screen at once and reloads once the pass is saved', async ({ page }) => {
    await restoreFromThisMonth(page);
    const status = page.getByTestId('sync-status');
    await expect(status).toHaveText(/^Syncing · [\d,]+ blocks left$/);
    await mark(page);
    await page.getByRole('button', { name: 'Lock' }).click();

    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toBeVisible();
    expect(await samePage(page), 'no reload yet').toBe(true);
    // Nothing of the wallet is on screen meanwhile.
    await expect(
      page.locator('.side, .topbar, .tabbar, nav, [data-testid="sync-status"], [data-testid^="balance-"]'),
    ).toHaveCount(0);

    const reloaded = page.waitForEvent('load');
    await setKnobs(page, { holdPass: false });
    await reloaded;
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toHaveCount(0);

    // The restore was saved before the reload: with passes held again, the
    // wallet is up to date right after unlocking instead of starting over.
    await unlock(page);
    await expect(status).toHaveText(`Up to date · block ${en(TIP)}`);
  });

  test('unlocking meanwhile goes back to the running restore, without a reload', async ({ page }) => {
    await restoreFromThisMonth(page);
    const status = page.getByTestId('sync-status');
    await expect(status).toHaveText(/^Syncing · [\d,]+ blocks left$/);
    const left = (await status.textContent())!;
    await mark(page);
    await page.getByRole('button', { name: 'Lock' }).click();

    await unlock(page, 'nope-nope-nope');
    await expect(page.getByText('Wrong password.')).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toBeVisible();
    await unlock(page);
    await expect(status).toHaveText(left);

    await setKnobs(page, { holdPass: false });
    await expect(status).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
    await nav(page, 'History');
    await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
    expect(await samePage(page), 'never reloaded').toBe(true);
  });

  test('an auto-lock says why, before and after the reload', async ({ page }) => {
    await page.clock.install();
    await restoreFromThisMonth(page);
    await expect(page.getByTestId('sync-status')).toHaveText(/^Syncing/);
    await page.clock.setSystemTime((await nowInPage(page)) + 16 * 60_000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(IDLE_NOTICE)).toBeVisible();
    await expect(page.getByText(SOFT_NOTE)).toBeVisible();
    const reloaded = page.waitForEvent('load');
    await setKnobs(page, { holdPass: false });
    await reloaded;
    await expect(page.getByText(IDLE_NOTICE)).toBeVisible();

    // Unlocking forgets the reason: a later lock by hand shows none.
    await unlock(page);
    await expect(page.getByTestId('balance-total')).toBeVisible();
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByText(/Locked automatically/)).toHaveCount(0);
  });
});
