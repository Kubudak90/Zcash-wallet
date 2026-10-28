import { expect, test, type Page } from '@playwright/test';

import { CLEAR_AFTER_MS } from '../../src/lib/clipboard';
import { PASSWORD, UA, createWallet } from './helpers';

// Hiding balances on screen, and clearing a copied viewing key from the
// clipboard. The fake wallet holds 1.25 ZEC shielded and 0.50 ZEC
// transparent after its first sync (src/engine/fake.ts).

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

  // History and the Send form's balance hints are masked too.
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const received = page.getByTestId('history').locator('.tx').first();
  await expect(received.locator('.tx-amount [aria-hidden="true"]')).toHaveText('+••••');
  await expect(page.getByTestId('history')).not.toContainText(/\d[.,]\d{2}/);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Spendable shielded balance: •••• ZEC')).toBeVisible();
  await expect(page.getByText('You also have •••• ZEC of transparent funds.')).toBeVisible();

  // A spend always shows what it pays, on the confirm and the result screen.
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

test.describe('a copied viewing key', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

  /** Shows the viewing key in Settings, copies it and returns it. */
  async function copyViewingKey(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Show viewing key' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal' }).click();
    const key = (await page.getByTestId('viewing-key').textContent())!;
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await clipboardText(page)).toBe(key);
    return key;
  }

  test('is cleared from the clipboard a minute later, and the note says how far that goes', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    const key = await copyViewingKey(page);
    const note = page.getByRole('status').filter({ hasText: /clear the clipboard/ });
    await expect(note).toHaveText(/60 seconds after copying.*only while this tab is in front.*may be cleared instead/);

    await page.clock.fastForward(CLEAR_AFTER_MS - 1_000);
    expect(await clipboardText(page)).toBe(key);
    await page.clock.fastForward(2_000);
    await expect.poll(() => clipboardText(page)).toBe('');
    await expect(page.getByRole('status').filter({ hasText: 'Clipboard cleared.' })).toBeVisible();
  });

  test('waits for the tab to have focus again', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    const key = await copyViewingKey(page);
    await page.evaluate(() => {
      document.hasFocus = () => false;
    });
    await page.clock.fastForward(CLEAR_AFTER_MS + 30_000);
    expect(await clipboardText(page)).toBe(key);

    await page.evaluate(() => {
      delete (document as { hasFocus?: unknown }).hasFocus;
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => clipboardText(page)).toBe('');
  });

  test('leaves the clipboard alone once something else was copied', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    await copyViewingKey(page);
    await page.getByRole('button', { name: 'Receive' }).click();
    await page.getByRole('button', { name: 'Copy' }).click();
    const address = (await page.getByTestId('receive-address').textContent())!;
    await page.clock.fastForward(2 * CLEAR_AFTER_MS);
    expect(await clipboardText(page)).toBe(address);
  });

  test('copied by hand, it is cleared too; other text copied by hand is not', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Show viewing key' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal' }).click();
    const key = page.getByTestId('viewing-key');
    await key.selectText();
    await page.keyboard.press('ControlOrMeta+C');
    expect(await clipboardText(page)).toBe(await key.textContent());
    await expect(page.getByRole('status').filter({ hasText: /clear the clipboard/ })).toBeVisible();
    await page.clock.fastForward(CLEAR_AFTER_MS + 1_000);
    await expect.poll(() => clipboardText(page)).toBe('');

    // Some other text selected and copied: nothing is scheduled.
    await page.getByText('Anyone with this key can see').selectText();
    await page.keyboard.press('ControlOrMeta+C');
    const help = await clipboardText(page);
    expect(help).toMatch(/^Anyone with this key/);
    await page.clock.fastForward(2 * CLEAR_AFTER_MS);
    expect(await clipboardText(page)).toBe(help);
  });

  test('is still cleared when the wallet locks first', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    await copyViewingKey(page);
    // Locking reloads the page; the pending clear outlives it.
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
    await page.clock.fastForward(CLEAR_AFTER_MS + 1_000);
    await expect.poll(() => clipboardText(page)).toBe('');
  });
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
