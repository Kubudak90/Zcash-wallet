import { bech32m } from '@scure/base';
import { expect, test, type Page } from '@playwright/test';

// Auto-lock, restore input and view-only wording. Kept apart from
// wallet.spec.ts so these flows can be read (and run) on their own.

const PASSWORD = 'Gizli-Parola-2026';
// BIP39 test vector: a valid 12-word phrase.
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const UFVK = bech32m.encode('uview', bech32m.toWords(new Uint8Array(120).fill(9)), false);

async function setPassword(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Up to date', { timeout: 20_000 });
}

async function restore(page: Page, mode: 'seed' | 'view') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore an existing wallet' }).click();
  if (mode === 'view') await page.getByRole('tab', { name: 'View only' }).click();
  await page.getByRole('textbox').fill(mode === 'seed' ? SEED : UFVK);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Month').fill('2025-03');
  await page.getByRole('button', { name: 'Continue' }).click();
}

const nowInPage = (page: Page) => page.evaluate(() => Date.now());
const wake = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('auto-lock counts the time the device slept and says why it locked', async ({ page }) => {
  await page.clock.install();
  await restore(page, 'seed');
  await setPassword(page);

  // Ten minutes asleep is under the 15-minute default: still unlocked.
  await page.clock.setSystemTime((await nowInPage(page)) + 10 * 60_000);
  await wake(page);
  expect(await page.evaluate(() => sessionStorage.getItem('celari.autoLocked'))).toBeNull();
  await expect(page.getByTestId('balance-total')).toBeVisible();

  // A lid closed overnight: timers stood still, the wall clock did not.
  await page.clock.setSystemTime((await nowInPage(page)) + 8 * 3600_000);
  await wake(page);
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  await expect(page.getByText('Locked automatically after 15 minutes of inactivity.')).toBeVisible();

  // The first key press after a long gap locks instead of restarting the countdown.
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('balance-total')).toBeVisible();
  await page.clock.setSystemTime((await nowInPage(page)) + 8 * 3600_000);
  await page.keyboard.press('Shift');
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  await expect(page.getByText('Locked automatically after 15 minutes of inactivity.')).toBeVisible();

  // Locking by hand shows no such notice.
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  await expect(page.getByText(/Locked automatically/)).toBeHidden();
});

test('restore: a typed birthday month where the browser has no month picker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore an existing wallet' }).click();
  await page.getByRole('textbox').fill(SEED);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Desktop Firefox and Safari render type="month" as a plain text box.
  const month = page.getByLabel('Month');
  await month.evaluate((el) => el.setAttribute('type', 'text'));
  await expect(month).toHaveAttribute('placeholder', 'YYYY-MM');
  const next = page.getByRole('button', { name: 'Continue' });

  await month.fill('2023-13');
  await month.blur();
  await expect(next).toBeDisabled();
  await expect(month).toHaveAttribute('aria-invalid', 'true');
  await expect(month).toHaveAccessibleDescription(/such as 2023-05 or 05\.2023/);

  await month.fill('05.2023');
  await expect(month).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByText(/such as 2023-05/)).toBeHidden();
  await next.click();
  await expect(page.getByText(/Sync will start at block/)).toBeVisible();
  await expect(page.getByText(/restore the wallet from your recovery phrase/)).toBeVisible();
});

test('view-only wallet: recovery and wipe texts talk about the viewing key', async ({ page }) => {
  await restore(page, 'view');
  await expect(page.getByText(/add the wallet again with your viewing key/)).toBeVisible();
  await expect(page.getByText(/recovery phrase/)).toBeHidden();
  await setPassword(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Without your viewing key you cannot add this wallet again.', { exact: false })).toBeVisible();
  await expect(page.getByText(/funds will be lost/)).toBeHidden();
});

test('Turkish: the wipe confirmation accepts SİL typed as SIL', async ({ page }) => {
  await restore(page, 'view');
  await setPassword(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();

  await expect(page.getByLabel('Sunucu (lightwalletd gRPC-web proxy)')).toHaveValue(/^https:/);
  await expect(page.getByText('Görüntüleme anahtarın yanında değilse', { exact: false })).toBeVisible();
  const wipe = page.getByRole('button', { name: 'Cüzdanı bu tarayıcıdan sil' });
  await page.getByLabel('Onaylamak için SİL yaz').fill('SIL');
  await expect(wipe).toBeEnabled();
  await page.getByLabel('Onaylamak için SİL yaz').fill('SOL');
  await expect(wipe).toBeDisabled();
  await page.getByLabel('Onaylamak için SİL yaz').fill('sil');
  await wipe.click();
  await expect(page.getByRole('button', { name: 'Yeni cüzdan oluştur' })).toBeVisible();
});
