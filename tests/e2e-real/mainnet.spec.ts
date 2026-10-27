import { expect, test } from '@playwright/test';

const PASSWORD = 'Gizli-Parola-2026';

test('real engine: create a wallet, sync from the tip, lock and unlock', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[browser] ${msg.text()}`);
  });

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

  await expect(page.getByTestId('sync-status')).toContainText('Up to date', { timeout: 8 * 60_000 });
  await expect(page.getByTestId('balance-total')).toContainText('0.00');

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
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Up to date', { timeout: 5 * 60_000 });
});
