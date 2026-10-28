import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet } from './helpers';

// Hiding balances on screen. The fake wallet holds 1.25 ZEC shielded and
// 0.50 ZEC transparent after its first sync (src/engine/fake.ts).

const BALANCES = ['balance-total', 'balance-shielded', 'balance-transparent'];

async function unlock(page: Page) {
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

test('the eye hides every balance, stays on across a lock, and never hides a spend', async ({ page }) => {
  await createWallet(page);
  const toggle = page.getByRole('button', { name: 'Hide balances' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('balance-total')).toContainText('1.75');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  for (const id of BALANCES) {
    const amount = page.getByTestId(id);
    await expect(amount).toContainText('••••');
    await expect(amount, id).not.toContainText(/\d/);
    // Screen readers hear words, not four bullets.
    await expect(amount.locator('[aria-hidden="true"]')).toHaveText('••••');
    await expect(amount.locator('.visually-hidden')).toHaveText('amount hidden');
  }
  await expect(page.getByText('•••• ZEC sits on a public transparent address.')).toBeVisible();
  // The threshold is the network's, not the wallet's, and stays readable.
  await expect(page.locator('main')).not.toContainText(/1[.,]75|1[.,]25|0[.,]50/);

  // Kept across a lock, which reloads the page.
  await page.getByRole('button', { name: 'Lock' }).click();
  await unlock(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('balance-total')).not.toContainText(/\d/);

  // A spend always shows what it pays, on the confirm and the result screen.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByTestId('confirm-amount')).toHaveText('0.10 ZEC');
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });

  // Off again: 1.75 - 0.1 - 0.0001 fee.
  await page.getByRole('button', { name: 'Balance' }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('balance-total')).toContainText('1.6499');
  await expect(page.getByText('0.50 ZEC sits on a public transparent address.')).toBeVisible();
});

test('the eye is named in Turkish too', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Bakiye' }).click();
  await page.getByRole('button', { name: 'Bakiyeleri gizle' }).click();
  await expect(page.getByTestId('balance-total').locator('.visually-hidden')).toHaveText('tutar gizlendi');
  await expect(page.getByText('•••• ZEC herkesin görebildiği şeffaf adreste duruyor.', { exact: false })).toBeVisible();
});
