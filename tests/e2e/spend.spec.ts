import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet } from './helpers';

// Send and shield flows on the fake engine. The fake wallet holds 1.25 ZEC
// shielded and 0.50 ZEC transparent after its first sync; sends of 0.0333 and
// 0.0666 ZEC fail while proving and while broadcasting (src/engine/fake.ts).

async function review(page: Page, to: string, amount: string) {
  await page.getByLabel('Recipient address').fill(to);
  await page.getByLabel('Amount (ZEC)').fill(amount);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm sending' })).toBeVisible();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
}

const sendButton = (page: Page) => page.locator('form').getByRole('button', { name: 'Send', exact: true });

type Knobs = { holdStage?: string; holdPass?: boolean; chainGrowth?: number; failPass?: boolean };

/** Changes the fake engine's knobs (src/engine/fake.ts) on the running page. */
async function setKnobs(page: Page, knobs: Knobs) {
  await page.evaluate((k) => {
    const g = globalThis as { __fakeEngine?: Knobs };
    g.__fakeEngine = { ...g.__fakeEngine, ...k };
  }, knobs);
}

test('a running send cannot be left or repeated', async ({ page }) => {
  // The spend stops at proving until released, so nothing below races it.
  await page.addInitScript(() => {
    (globalThis as { __fakeEngine?: Knobs }).__fakeEngine = { holdStage: 'proving' };
  });
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await review(page, UA, '0.4');

  // Two submits while the password is still being checked (the field has focus after fill).
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(page.locator('.stages li[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Back/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lock' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Balance' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeDisabled();

  // While proving, two rows are done, one current and one pending: the labels still line up,
  // and the status region carries the current stage for screen readers.
  await expect(page.locator('.stages li.current')).toContainText('Generating zero-knowledge proofs');
  await expect(page.getByRole('status').filter({ hasText: 'Generating zero-knowledge proofs' })).toHaveCount(1);
  await expect(page.locator('.stages li.done')).toHaveCount(2);
  const xs = await page
    .locator('.stages li > span:last-child')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
  expect(xs).toHaveLength(4);
  expect(new Set(xs).size).toBe(1);
  await setKnobs(page, { holdStage: undefined });

  const result = page.getByRole('heading', { name: '0.40 ZEC sent' });
  await expect(result).toBeVisible({ timeout: 10_000 });
  await expect(result).toBeFocused();
  await expect(page.locator('.summary')).toContainText(UA.slice(0, 12));
  await expect(page.getByRole('button', { name: 'Lock' })).toBeEnabled();

  await page.getByRole('button', { name: 'View in history' }).click();
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  await expect(page.getByTestId('history').locator('.tx-sent')).toHaveCount(1);
});

test('a failed spend says whether it is safe to try again', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // Proving fails: nothing left the wallet, so the retry form stays.
  await review(page, UA, '0.0333');
  await sendButton(page).click();
  await expect(page.getByText('Nothing was sent. You can try again.')).toBeVisible({ timeout: 10_000 });
  await expect(sendButton(page)).toBeVisible();

  // Broadcasting fails: the payment may be out, so no retry is offered and no fix is suggested.
  await page.getByRole('button', { name: /Back/ }).click();
  await review(page, UA, '0.0666');
  await sendButton(page).click();
  await expect(page.getByText('may have reached the network anyway')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Lower the amount')).toHaveCount(0);
  await expect(page.getByLabel('Enter your password to confirm')).toHaveCount(0);
  await expect(sendButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Balance' })).toBeEnabled();

  // Like WebZjs, the fake engine stored the transaction before broadcasting it:
  // History shows it at once, and it is saved, so it survives a lock.
  await page.getByRole('button', { name: 'View in history' }).click();
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  const sent = page.getByTestId('history').locator('.tx-sent');
  await expect(sent).toHaveCount(1);
  await expect(sent).toContainText('-0.0667');
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(sent).toHaveCount(1);
});

test('a failed pass keeps spending closed while the wallet is known to be behind', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await review(page, UA, '0.1');
  // The send kicks off a pass that measures 50 new blocks and then fails before scanning them.
  await setKnobs(page, { chainGrowth: 50, failPass: true });
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('sync-status')).toHaveText('Connection problem, will retry');

  await page.getByRole('button', { name: 'New payment' }).click();
  await review(page, UA, '0.2');
  await expect(page.getByTestId('spend-wait')).toHaveText(/50 blocks behind/);
  await expect(sendButton(page)).toBeDisabled();

  // The retry 10 s later goes through.
  await setKnobs(page, { failPass: false });
  await expect(page.getByTestId('spend-wait')).toHaveCount(0, { timeout: 20_000 });
  await expect(sendButton(page)).toBeEnabled();
});

test('spending waits while the wallet is catching up', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await review(page, UA, '0.1');
  // The send kicks off a pass; 50 new blocks make it a catch-up, held open here.
  await setKnobs(page, { chainGrowth: 50, holdPass: true });
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('sync-status')).toHaveText('Syncing · 50 blocks left');

  await page.getByRole('button', { name: 'New payment' }).click();
  await review(page, UA, '0.2');
  await expect(page.getByTestId('spend-wait')).toHaveText(/still syncing \(50 blocks left\)/);
  await expect(sendButton(page)).toBeDisabled();

  await setKnobs(page, { holdPass: false });
  await expect(page.getByTestId('spend-wait')).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();
});

test('payment links that cannot be paid as asked are refused', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const to = page.getByLabel('Recipient address');
  const confirm = page.getByRole('heading', { name: 'Confirm sending' });

  const multi = `zcash:?address=${UA}&amount=0.1&address.1=${UA}&amount.1=0.2`;
  await to.fill(multi);
  await expect(to).toHaveValue(multi);
  await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(to).toHaveAccessibleDescription(/several recipients are not supported/);
  await expect(confirm).toHaveCount(0);

  await to.fill(`zcash:${UA}?amount=0.3&req-futurefeature=1`);
  await expect(page.getByText('uses a feature Celari does not support')).toBeVisible();

  await to.fill(`zcash:${UA}?amount=0.2&memo=SGk`);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(to).toHaveAccessibleDescription(/asks for a memo/);
  await expect(confirm).toHaveCount(0);

  // Typing a link by hand does not wipe it at the colon.
  await to.fill('');
  await to.pressSequentially('zcash:');
  await expect(to).toHaveValue('zcash:');
});

test('send form errors are tied to their fields', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const to = page.getByLabel('Recipient address');
  const amount = page.getByLabel('Amount (ZEC)');

  await to.fill('u1bad');
  await amount.fill('5');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(to).toBeFocused();
  await expect(to).toHaveAttribute('aria-invalid', 'true');
  await expect(to).toHaveAccessibleDescription(/not a valid Zcash address/i);
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(amount).toHaveAccessibleDescription(/does not cover/i);

  // With the address fixed, focus goes to the amount, the first field still in error.
  await to.fill(UA);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(amount).toBeFocused();
  await expect(to).toHaveAttribute('aria-invalid', 'false');
});

test('Send explains that transparent funds must be shielded first', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('You also have 0.50 ZEC of transparent funds.')).toBeVisible();

  // 1.6 ZEC fits only once the 0.50 transparent is shielded.
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill('1.6');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByText('Shield your transparent funds first, then send.')).toBeVisible();

  await page.getByRole('button', { name: 'Shield funds' }).click();
  await expect(page.getByRole('heading', { name: 'Shield funds' })).toBeVisible();
});

test('Turkish amount entry uses a decimal comma', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Gönder', exact: true }).click();

  const amount = page.getByLabel('Tutar (ZEC)');
  await expect(amount).toHaveAttribute('placeholder', '0,00');
  await page.getByRole('button', { name: 'Tümü' }).click();
  await expect(amount).toHaveValue('1,2499');

  // A lone dot is a decimal point; the echo makes that visible.
  await amount.fill('1.000');
  await expect(page.getByText('= 1,00 ZEC')).toBeVisible();

  await page.getByLabel('Alıcı adresi').fill(`zcash:${UA}?amount=1.001`);
  await expect(amount).toHaveValue('1,001');
});

test.describe('copying', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Copy announces the result', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Receive' }).click();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(1);
  });
});
