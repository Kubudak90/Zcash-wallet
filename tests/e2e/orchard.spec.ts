import { expect, test } from '@playwright/test';

import { PASSWORD, TIP, UA, createWallet, en, nav, restoreFrom } from './helpers';

// Orchard funds with the ported engine (ironwood = true): spendable as usual, the change of a
// spend goes to Ironwood and the amount crossing pools is public (ZIP 318). The fake gives a
// wallet born before NU6.3 its 1.25 ZEC in Orchard, a newer one in Ironwood.

const FROM_ORCHARD =
  'Partly shielded payment: the recipient and the memo stay private, but it is paid from your Orchard funds, and the amount that crosses from Orchard into Ironwood is visible on chain (the ZIP 318 turnstile).';
const NOTE =
  '1.25 ZEC of your shielded balance is in the Orchard pool and can be spent as usual. Spending from it moves the change into Ironwood, the new shielded pool, and the amount that crosses from Orchard into Ironwood is visible on chain (the ZIP 318 turnstile). Celari does not offer a private, gradual migration to Ironwood yet.';

test('Orchard funds: an accurate note while there are any, the shield goes to Ironwood, and spending moves them on', async ({
  page,
}) => {
  await restoreFrom(page, '2025-03');
  await expect(page.getByTestId('sync-status')).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
  const note = page.getByTestId('orchard-note');
  await expect(note).toHaveText(NOTE);
  // Hidden balances hide its amount too.
  await page.getByRole('button', { name: 'Hide balances' }).click();
  await expect(note).toHaveText(/^•••• ZEC of your shielded balance is in the Orchard pool/);
  await page.getByRole('button', { name: 'Hide balances' }).click();

  await page.getByRole('button', { name: 'Shield funds' }).click();
  await expect(
    page.getByText('0.50 ZEC of transparent funds will move to your shielded balance, into the Ironwood pool.'),
  ).toBeVisible();
  await page.getByRole('button', { name: /Back/ }).click();

  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await nav(page, 'Bakiye');
  await expect(note).toHaveText(
    'Gizli bakiyenin 1,25 ZEC’lik kısmı Orchard havuzunda ve her zamanki gibi harcanabilir. Ondan harcadığında para üstü yeni gizli havuz Ironwood’a geçer; Orchard’dan Ironwood’a geçen tutar zincirde görünür (ZIP 318 turnike kuralı). Celari henüz Ironwood’a gizli ve kademeli bir taşıma sunmuyor.',
  );
  await nav(page, 'Ayarlar');
  await page.getByRole('button', { name: 'English' }).click();

  // A payment spends the Orchard note; its change lands in Ironwood, and the note goes.
  // Paid from Orchard, the amount crossing into Ironwood is public: Send does not call it
  // shielded (review round 7, ES-2), on the form nor on the confirm step.
  await nav(page, 'Send');
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  const preview = page.locator('.send-preview');
  await expect(preview).toContainText('Unified · partly shielded');
  await expect(preview).toContainText(FROM_ORCHARD);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.locator('.summary-privacy dd')).toHaveText('Partly shielded');
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  // The result keeps what was confirmed, though the funds are in Ironwood now.
  await expect(page.locator('.summary-privacy dd')).toHaveText('Partly shielded');
  await nav(page, 'Balance');
  await expect(page.getByTestId('balance-shielded')).toContainText('1.1499');
  await expect(note).toHaveCount(0);

  // From Ironwood alone, the next payment is shielded.
  await nav(page, 'Send');
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  await expect(preview).toContainText('Unified · shielded');
  await expect(preview).toContainText('Shielded payment');
});

test('a wallet born after NU6.3 holds no Orchard funds and shows no Orchard note', async ({ page }) => {
  await createWallet(page);
  await expect(page.getByTestId('balance-shielded')).toContainText('1.25');
  await expect(page.getByTestId('orchard-note')).toHaveCount(0);
});
