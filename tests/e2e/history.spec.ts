import { sha256 } from '@noble/hashes/sha256';
import { base58check } from '@scure/base';
import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet } from './helpers';

// History rows carry a privacy label from the pool WebZjs reports. The fake
// engine reports pools the way WebZjs does: the recipient's pool plus Orchard
// change, 'mixed' when they differ; a shield is all Orchard.

const T1 = base58check(sha256).encode(new Uint8Array([0x1c, 0xb8, ...new Uint8Array(20).fill(7)]));

async function send(page: Page, to: string, amount: string | 'max') {
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill(to);
  if (amount === 'max') await page.getByRole('button', { name: 'Max' }).click();
  else await page.getByLabel('Amount (ZEC)').fill(amount);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: /ZEC sent$/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'New payment' }).click();
}

test('each History row says how private it was, in words and not only in colour', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Shield funds' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Shield', exact: true }).click();
  await expect(page.getByRole('heading', { name: /is being shielded/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close' }).click();
  await send(page, UA, '0.1'); // Orchard to Orchard, Orchard change
  await send(page, T1, '0.1'); // transparent payment, Orchard change
  await send(page, T1, 'max'); // transparent payment, no change

  await page.getByRole('button', { name: 'History', exact: true }).click();
  const rows = page.getByTestId('history').locator('.tx');
  const labels = rows.locator('.privacy');
  // Newest first.
  // The mark before each label is decoration (aria-hidden); the words carry the meaning.
  // A shielding's outputs are shielded, but its transparent inputs show the amount.
  await expect(labels).toHaveText([
    /Privacy: Transparent · public$/,
    /Privacy: Partly shielded$/,
    /Privacy: Shielded$/,
    /Privacy: Shielded · amount public$/,
    /Privacy: Shielded$/,
  ]);
  await expect(rows.nth(3)).toHaveClass(/tx-shielded/);
  await expect(rows.nth(4)).toHaveClass(/tx-received/);

  // The list explains the labels, and what they do not cover, on entry.
  const note = page.getByText('Labels look only at this wallet’s own outputs');
  await expect(note).toBeVisible();
  await expect(page.getByTestId('history')).toHaveAccessibleDescription(
    /^Labels look only at this wallet’s own outputs.*Transparent inputs, this wallet’s own included, are always public\.$/,
  );
  // A mark that differs by shape, not only by colour.
  const marks = await labels.locator('[aria-hidden="true"]').allTextContents();
  expect(new Set(marks).size).toBe(3);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Geçmiş', exact: true }).click();
  await expect(labels).toHaveText([
    /Gizlilik: Şeffaf · herkese açık$/,
    /Gizlilik: Kısmen gizli$/,
    /Gizlilik: Gizli$/,
    /Gizlilik: Gizliye aktarıldı · tutar herkese açık$/,
    /Gizlilik: Gizli$/,
  ]);
  await expect(page.getByText('Etiketler yalnızca bu cüzdanın kendi çıktılarına bakar')).toBeVisible();
});
