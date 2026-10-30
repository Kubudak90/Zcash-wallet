import { sha256 } from '@noble/hashes/sha256';
import { base58check, bech32 } from '@scure/base';
import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet, nav, setKnobs } from './helpers';

// History rows carry a privacy label from the pool WebZjs reports. The fake
// engine reports pools the way WebZjs does: the recipient's pool plus Orchard
// change, 'mixed' when they differ; a shield is all Orchard.

const T1 = base58check(sha256).encode(new Uint8Array([0x1c, 0xb8, ...new Uint8Array(20).fill(7)]));
// A valid Sapling address (bech32 over 43 bytes).
const ZS = bech32.encode('zs', bech32.toWords(new Uint8Array(43).fill(7)), 90);

async function send(page: Page, to: string, amount: string | 'max') {
  await nav(page, 'Send');
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

  await nav(page, 'History');
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

  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await nav(page, 'Geçmiş');
  await expect(labels).toHaveText([
    /Gizlilik: Şeffaf · herkese açık$/,
    /Gizlilik: Kısmen gizli$/,
    /Gizlilik: Gizli$/,
    /Gizlilik: Gizliye aktarıldı · tutar herkese açık$/,
    /Gizlilik: Gizli$/,
  ]);
  await expect(page.getByText('Etiketler yalnızca bu cüzdanın kendi çıktılarına bakar')).toBeVisible();
});

test.describe('the transaction ID', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a row shows its transaction ID on request, and copies it', async ({ page }) => {
    await createWallet(page);
    await send(page, UA, '0.1');
    await nav(page, 'History');
    // Rows are grouped: one not in a block, then the month of the first payment.
    await expect(page.getByTestId('history').locator('.month-head')).toHaveText(['Not in a block', /^\w+ \d{4}$/]);

    const row = page.getByTestId('history').locator('.tx').first();
    const toggle = row.getByRole('button', { name: 'Transaction ID', exact: true });
    const copy = row.getByRole('button', { name: 'Copy transaction ID' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Every row's toggle has this name; its description says which payment it opens.
    await expect(toggle).toHaveAccessibleDescription('Sent, Pending, -0.1001 ZEC');
    await expect(copy).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const txid = (await row.locator('.txid code').textContent())!;
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(txid);
  });
});

test('an open transaction ID stays open, and keeps focus, when a new payment shifts the groups', async ({ page }) => {
  test.slow();
  await createWallet(page);
  await nav(page, 'Receive');
  const own = (await page.getByTestId('receive-address').textContent())!;
  await send(page, UA, '0.1');
  await nav(page, 'History');
  const history = page.getByTestId('history');
  await expect(history.locator('.month-head')).toHaveText(['Not in a block', /^\w+ \d{4}$/]);
  const received = history.locator('.tx-received');
  const toggle = received.getByRole('button', { name: 'Transaction ID', exact: true });
  await toggle.click();
  const copy = received.getByRole('button', { name: 'Copy transaction ID' });
  await copy.focus();

  // The next pass brings a payment in at the top, in a group of its own: the groups below
  // move down one place, and must not be rebuilt (closing the row and dropping focus).
  await setKnobs(page, { incoming: [own] });
  await expect(history.locator('.tx')).toHaveCount(3, { timeout: 45_000 });
  await expect(history.locator('.month-head')).toHaveText([/^\w+ \d{4}$/, 'Not in a block', /^\w+ \d{4}$/]);
  const first = history.locator('.tx-received').last();
  await expect(first.getByRole('button', { name: 'Transaction ID', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(first.getByRole('button', { name: 'Copy transaction ID' })).toBeFocused();
});

test('a payment to a Sapling address is called partly shielded, as History calls it', async ({ page }) => {
  await createWallet(page);
  await nav(page, 'Send');
  await page.getByLabel('Recipient address').fill(ZS);
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  await expect(page.getByLabel('Recipient address')).toHaveAccessibleDescription(/Sapling · partly shielded/);
  await expect(page.locator('.send-preview')).toContainText('Partly shielded payment');
  await page.getByRole('button', { name: 'Review' }).click();
  // The amount entering Sapling shows on chain: never "Shielded" beside it.
  const tag = page.locator('.summary-privacy dd');
  await expect(tag).toHaveText('Partly shielded');
  await expect(tag.locator('.kind-tag')).toHaveClass(/kind-partial/);
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await expect(tag).toHaveText('Partly shielded');
  await nav(page, 'History');
  await expect(page.getByTestId('history').locator('.tx-sent .privacy')).toHaveClass(/privacy-partial/);
});
