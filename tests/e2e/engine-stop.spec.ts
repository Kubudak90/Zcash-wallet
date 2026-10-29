import { expect, test } from '@playwright/test';

import { fakeEngine, restoreFromThisMonth, setKnobs } from './helpers';

// Verifier finding M1, app side. Before round 5 a restore across the 2022-2023 spam era filled
// the engine's 1 GiB memory and its WebAssembly trapped in a worker: the sync call never settled
// and the app showed "Syncing · N blocks left" for as long as the tab was open.

const lockScreen = 'Your wallet is locked';

test('a trap of the engine during a pass says so and offers a reload, instead of syncing forever', async ({ page }) => {
  await fakeEngine(page, { trapDuringPass: true });
  await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  await expect(page.getByTestId('engine-stopped')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('engine-stopped')).toContainText('wallet engine stopped');
  await expect(status).toHaveText('Stopped · reload needed');
  await expect(status).toHaveAttribute('data-sync', 'stopped');
  // Nothing is retried on a stopped engine: past the 10 s retry and the 30 s interval it stays.
  await page.waitForTimeout(12_000);
  await expect(status).toHaveAttribute('data-sync', 'stopped');
  await expect(page.getByTestId('engine-stopped')).toBeVisible();

  // Reloading locks the wallet and starts a fresh engine.
  await setKnobs(page, { trapDuringPass: false });
  await page.getByRole('button', { name: 'Reload Celari' }).first().click();
  await expect(page.getByRole('heading', { name: lockScreen })).toBeVisible();
});

test('a catch-up pass whose counters stand still for 10 minutes is flagged, and the flag goes when they move', async ({ page }) => {
  await page.clock.install();
  await fakeEngine(page, { passCounters: true, holdPass: true });
  await restoreFromThisMonth(page);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-sync', 'syncing');
  // A minute at a time, so the pass's 1 s progress poll runs at each step.
  const minutes = async (n: number) => {
    for (let i = 0; i < n; i++) await page.clock.fastForward(60_000);
  };
  await minutes(5);
  await expect(page.getByTestId('sync-stalled')).toHaveCount(0);
  await minutes(7);
  await expect(page.getByTestId('sync-stalled')).toBeVisible();
  await expect(page.getByTestId('sync-stalled')).toContainText('has not moved for 10 minutes');
  await expect(status).toHaveAttribute('data-sync', 'syncing');

  await setKnobs(page, { holdPass: false });
  await page.clock.fastForward(30_000);
  await expect(page.getByTestId('sync-stalled')).toHaveCount(0, { timeout: 10_000 });
});
