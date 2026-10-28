import { expect, test } from '@playwright/test';

const PASSWORD = 'Gizli-Parola-2026';

test('real engine: create a wallet, sync from the tip, lock and unlock', async ({ page }) => {
  // A wasm panic can leave a call hanging instead of rejecting, so the UI
  // alone would not show it.
  // Panics, uncaught errors and a database rebuilt instead of reopened are
  // collected, and the sync waits below stop as soon as one shows up.
  const failures: string[] = [];
  const fail = (text: string) => {
    console.log(`[browser] ${text}`);
    failures.push(text);
  };
  page.on('console', (msg) => {
    if (/panicked|rebuilding the wallet database/.test(msg.text())) fail(msg.text());
    else if (msg.type() === 'error') console.log(`[browser] ${msg.text()}`);
  });
  page.on('pageerror', (err) => fail(String(err)));

  const status = page.getByTestId('sync-status');
  // `idle` is only set once a sync pass has resolved and the database is saved.
  async function synced(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    let state: string | null = null;
    while (failures.length === 0 && Date.now() < deadline) {
      state = await status.getAttribute('data-sync', { timeout: 1_000 }).catch(() => null);
      if (state === 'idle') return;
      await page.waitForTimeout(1_000);
    }
    expect(failures).toEqual([]);
    expect(state, `sync state after ${timeoutMs / 1000}s`).toBe('idle');
  }

  await page.goto('/');
  // Reaching the welcome screen means wasm, the thread pool and the
  // lightwalletd connection all initialised.
  await page.getByRole('button', { name: 'Create a new wallet' }).click({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Reveal words' }).click();
  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
  await page.getByLabel('I wrote the words down in order').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  for (const label of await page.locator('form .field > span').allTextContents()) {
    await page.getByLabel(label, { exact: true }).fill(words[Number(label.replace('Word #', '')) - 1]!);
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();

  await synced(8 * 60_000);
  await expect(status).toContainText('Up to date');
  await expect(page.getByTestId('balance-total')).toContainText('0.00');

  // What the engine says about the rules the network runs (GetLightdInfo,
  // src/engine/lightd.ts). It must get an answer: 'unverified' means the
  // check itself fails in this build. While the engine does not support the
  // network (WebZjs at NU6.1 against NU6.3 today), the banner shows and Send
  // has no form; once the engine catches up this part no longer applies.
  const main = page.locator('.main');
  await expect(main).not.toHaveAttribute('data-network', 'checking', { timeout: 60_000 });
  const network = await main.getAttribute('data-network');
  console.log(`[network] ${network}`);
  expect(network, 'the network check got an answer').toMatch(/^(supported|outdated)$/);
  const outdated = network === 'outdated';
  if (outdated) {
    await expect(page.getByTestId('network-banner')).toContainText('Celari is behind the Zcash network');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('spend-disabled')).toHaveText(
      'Sending is disabled until Celari is updated for the current Zcash network.',
    );
    await expect(page.getByLabel('Recipient address')).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByTestId('receive-address')).toHaveText(/^u1[0-9a-z]{100,}$/);
  await page.getByRole('button', { name: 'Show transparent address' }).click();
  await expect(page.getByTestId('receive-address')).toHaveText(/^t1[1-9A-HJ-NP-Za-km-z]{33}$/);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show viewing key' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.getByTestId('viewing-key')).toHaveText(/^uview1/);

  // The encrypted WebZjs database must survive a lock/unlock round trip.
  await page.getByRole('button', { name: 'Lock' }).click();
  // The lock screen asks the network too, before anything is unlocked.
  if (outdated) {
    await expect(page.getByTestId('network-banner')).toContainText('Celari is behind the Zcash network', { timeout: 30_000 });
  }
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await synced(5 * 60_000);
  expect(failures).toEqual([]);
});
