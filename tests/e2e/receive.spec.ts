import QRCode from 'qrcode';
import { expect, test, type Page } from '@playwright/test';

import { isShieldedOnlyUnified } from '../../src/lib/address';
import { PASSWORD, createWallet, fakeEngine, setKnobs } from './helpers';

// Receive shows a fresh unified address with shielded receivers only each time it opens
// (WebZjs get_next_shielded_address, docs/engine-port.md Decision 11); the transparent address stays.

const FRESH_NOTE =
  'For your privacy, Celari shows a new address each time you open this screen. Earlier addresses keep working.';
const PREVIOUS_NOTE =
  'This address was shown before and keeps working. Celari shows a new one when it can, usually the next time you open this screen.';

const address = (page: Page) => page.getByTestId('receive-address');
const note = (page: Page) => page.getByTestId('receive-fresh-note');

/** Opens Receive from another tab and returns the shielded address it shows. */
async function openReceive(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Balance', exact: true }).click();
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(address(page)).toHaveText(/^u1/);
  return (await address(page).textContent())!;
}

/** The QR code's markup for `value` (src/components/ui.tsx QrCode), as the page serializes it. */
async function qrFor(page: Page, value: string): Promise<string> {
  const svg = await QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return page.evaluate((markup) => {
    const div = document.createElement('div');
    div.innerHTML = markup;
    return div.innerHTML;
  }, svg);
}

async function lockAndUnlock(page: Page) {
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('balance-total')).toBeVisible();
}

test('each opening of Receive shows a new shielded-only address, which copy and the QR code use; the transparent one stays', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createWallet(page);

  const a = await openReceive(page);
  expect(isShieldedOnlyUnified(a), 'no transparent receiver').toBe(true);
  await expect(note(page)).toHaveText(FRESH_NOTE);
  expect(await page.locator('.qr').innerHTML()).toBe(await qrFor(page, a));
  await page.getByRole('button', { name: 'Copy' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(a);

  await page.getByRole('button', { name: 'Show transparent address' }).click();
  await expect(address(page)).toHaveText(/^t1/);
  const t = await address(page).textContent();
  await expect(note(page)).toHaveCount(0);
  // Back on the same opening: the same shielded address.
  await page.getByRole('button', { name: 'Back to shielded address' }).click();
  await expect(address(page)).toHaveText(a);

  const b = await openReceive(page);
  expect(b).not.toBe(a);
  expect(isShieldedOnlyUnified(b)).toBe(true);
  await expect(note(page)).toHaveText(FRESH_NOTE);
  expect(await page.locator('.qr').innerHTML()).toBe(await qrFor(page, b));
  await page.getByRole('button', { name: 'Copy' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(b);
  await page.getByRole('button', { name: 'Show transparent address' }).click();
  await expect(address(page)).toHaveText(t!);

  // The database remembers what was handed out: after a lock, still a new one.
  await lockAndUnlock(page);
  const c = await openReceive(page);
  expect([a, b]).not.toContain(c);
  expect(isShieldedOnlyUnified(c)).toBe(true);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Al', exact: true }).click();
  await expect(note(page)).toHaveText(
    'Gizliliğin için Celari bu ekranı her açtığında yeni bir adres gösterir. Önceki adreslerin de çalışmaya devam eder.',
  );
});

test('earlier addresses keep receiving', async ({ page }) => {
  await createWallet(page);
  await expect(page.getByTestId('balance-total')).toContainText('1.75');
  const a = await openReceive(page);
  const b = await openReceive(page);
  const c = await openReceive(page);
  expect(new Set([a, b, c]).size).toBe(3);
  // Two payments to the first two, one to someone else's address, in the next pass.
  const other = 'u1' + a.slice(2, -6) + 'qqqqqq';
  await fakeEngine(page, { incoming: [a, b, other] });
  await lockAndUnlock(page);
  await expect(page.getByTestId('balance-total')).toContainText('1.95');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByTestId('history').locator('.tx-received')).toHaveCount(3);
});

test('while a sync pass holds the database, Receive shows the address it showed last, then a new one', async ({
  page,
}) => {
  test.slow();
  await createWallet(page);
  const a = await openReceive(page);
  // The next pass waits until released; the one after a is ready before it starts.
  await setKnobs(page, { holdPass: true });
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync', 'syncing', { timeout: 40_000 });
  const b = await openReceive(page);
  expect(b).not.toBe(a);
  await expect(note(page)).toHaveText(FRESH_NOTE);

  // The next one waits for the pass to let go of the database.
  await page.getByRole('button', { name: 'Balance', exact: true }).click();
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByTestId('receive-preparing')).toHaveText('Preparing a new address…');
  await expect(address(page)).toHaveText(b);
  await expect(note(page)).toHaveText(PREVIOUS_NOTE);

  await setKnobs(page, { holdPass: false });
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync', 'idle', { timeout: 20_000 });
  const c = await openReceive(page);
  expect([a, b]).not.toContain(c);
  await expect(note(page)).toHaveText(FRESH_NOTE);
});
