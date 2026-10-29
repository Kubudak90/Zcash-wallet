import { sha256 } from '@noble/hashes/sha256';
import { base58check, base64urlnopad, bech32m } from '@scure/base';
import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet } from './helpers';

// Send and shield flows on the fake engine. The fake wallet holds 1.25 ZEC
// shielded and 0.50 ZEC transparent after its first sync; sends of 0.0333 and
// 0.0666 ZEC fail while proving and while broadcasting (src/engine/fake.ts).

// Valid-checksum transparent and TEX addresses; neither can receive a memo.
const T1 = base58check(sha256).encode(new Uint8Array([0x1c, 0xb8, ...new Uint8Array(20).fill(7)]));
const TEX = bech32m.encode('tex', bech32m.toWords(new Uint8Array(20).fill(7)), false);
/** A ZIP-321 memo value: base64url of the UTF-8 text, without padding. */
const linkMemo = (text: string) => base64urlnopad.encode(new TextEncoder().encode(text));

async function review(page: Page, to: string, amount: string) {
  await page.getByLabel('Recipient address').fill(to);
  await page.getByLabel('Amount (ZEC)').fill(amount);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm sending' })).toBeVisible();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
}

const sendButton = (page: Page) => page.locator('form').getByRole('button', { name: 'Send', exact: true });

type Knobs = {
  holdStage?: string;
  holdPass?: boolean;
  chainGrowth?: number;
  failPass?: boolean;
  engineFee?: number;
  refuseSpend?: 'UpgradePending' | 'PcztWrongBranch' | 'PcztExpired';
};

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

  // Proving fails: nothing left the wallet, so the retry form stays, and Back keeps the payment.
  await review(page, UA, '0.0333');
  await sendButton(page).click();
  await expect(page.getByText('Nothing was sent. You can try again.')).toBeVisible({ timeout: 10_000 });
  await expect(sendButton(page)).toBeVisible();
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByLabel('Recipient address')).toHaveValue(UA);
  await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('0.0333');

  // Broadcasting fails: the payment may be out, so no retry is offered and no fix is suggested.
  await page.getByLabel('Amount (ZEC)').fill('0.0666');
  await page.getByLabel('Memo (optional)').fill('one try only');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await sendButton(page).click();
  await expect(page.getByText('may have reached the network anyway')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Lower the amount')).toHaveCount(0);
  await expect(page.getByLabel('Enter your password to confirm')).toHaveCount(0);
  await expect(sendButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Balance' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'View in history' })).toBeVisible();

  // Back does not hand the same payment back for a second try.
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByRole('heading', { name: 'Send ZEC' })).toBeVisible();
  await expect(page.getByLabel('Recipient address')).toHaveValue('');
  await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('');
  await page.getByLabel('Recipient address').fill(UA);
  await expect(page.getByLabel('Memo (optional)')).toHaveValue('');

  // Like WebZjs, the fake engine stored the transaction before broadcasting it:
  // History shows it at once, and it is saved, so it survives a lock.
  await page.getByRole('button', { name: 'History', exact: true }).click();
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

test('a balance that does not cover the real fee is explained in ZEC, without the engine text (en, tr)', async ({ page }) => {
  // The engine asks more than the typical fee the form assumes, as for a TEX payment (ZIP 317:
  // 20,000 zatoshis), so "Max" passes the form and the engine refuses it (final review E2E-2).
  await page.addInitScript(() => {
    (globalThis as { __fakeEngine?: Knobs }).__fakeEngine = { engineFee: 20_000 };
  });
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByRole('button', { name: 'Max' }).click();
  await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('1.2499');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await sendButton(page).click();
  await expect(page.getByTestId('spend-failure')).toHaveText(
    'Nothing was sent: the spendable balance does not cover this payment. It needs 1.2501 ZEC including the network fee; 1.25 ZEC is spendable.',
    { timeout: 10_000 },
  );
  await expect(page.getByText('Sending failed.')).toBeVisible();
  // No English engine text in zatoshis, collapsed or not; the retry form stays.
  await expect(page.getByText('Details')).toHaveCount(0);
  await expect(page.getByText(/InsufficientFunds|Zatoshis/)).toHaveCount(0);
  await expect(sendButton(page)).toBeVisible();

  await page.getByRole('button', { name: /Back/ }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Gönder', exact: true }).click();
  await page.getByLabel('Alıcı adresi').fill(UA);
  await page.getByRole('button', { name: 'Tümü' }).click();
  await page.getByRole('button', { name: 'Gözden geçir' }).click();
  await page.getByLabel('Onaylamak için şifreni gir').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Gönder', exact: true }).click();
  await expect(page.getByTestId('spend-failure')).toHaveText(
    'Hiçbir şey gönderilmedi: harcanabilir bakiye bu ödemeyi karşılamıyor. Gereken (ağ ücreti dahil) 1,2501 ZEC, harcanabilir 1,25 ZEC.',
    { timeout: 10_000 },
  );
  await expect(page.getByText(/InsufficientFunds|Zatoshis/)).toHaveCount(0);
});

test('a send the engine refuses around a network upgrade says that nothing was sent', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const history = page.getByTestId('history').locator('.tx-sent');

  // While building: the pause before NU7 (the fake's tip is 9,605 blocks below it).
  await setKnobs(page, { refuseSpend: 'UpgradePending' });
  await review(page, UA, '0.1');
  await sendButton(page).click();
  await expect(page.getByTestId('spend-failure')).toHaveText(
    'Nothing was sent. Sending pauses for about 14 minutes around a network upgrade: NU7 activates at block 3,543,405, 9,604 blocks from now. Try again once it is active.',
    { timeout: 10_000 },
  );
  await expect(sendButton(page)).toBeVisible();

  // In pczt_send, after the broadcasting stage began: refused before anything was stored, so
  // this is not "may have reached the network", and trying again is offered.
  for (const [code, line] of [
    ['PcztWrongBranch', 'Nothing was sent: a network upgrade activated while the transaction was being prepared, so it could never be mined. Try again; a new one is built under the new rules.'],
    ['PcztExpired', 'Nothing was sent: the transaction would have expired before it could be mined. Try again; a new one is built.'],
  ] as const) {
    await setKnobs(page, { refuseSpend: code });
    await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
    await sendButton(page).click();
    await expect(page.getByTestId('spend-failure')).toHaveText(line, { timeout: 10_000 });
    await expect(page.getByText('may have reached the network')).toHaveCount(0);
    await expect(page.getByText('Details')).toHaveCount(0);
    await expect(sendButton(page)).toBeVisible();
  }

  // Trying again once the engine accepts it sends it, once.
  await setKnobs(page, { refuseSpend: undefined });
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'View in history' }).click();
  await expect(history).toHaveCount(1);
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

  // The form has the result's title; focus starts it again at the recipient, not on <body>.
  await page.getByRole('button', { name: 'New payment' }).click();
  await expect(page.getByLabel('Recipient address')).toBeFocused();
  await expect(page.getByLabel('Recipient address')).toHaveValue('');
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

  // A memo for a transparent address cannot be honoured, so the link is not paid without it.
  const memoToT1 = `zcash:${T1}?amount=0.2&memo=SGk`;
  await to.fill(memoToT1);
  await expect(to).toHaveValue(memoToT1);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(to).toHaveAccessibleDescription(/asks for a memo, but its address cannot receive one/);
  await expect(confirm).toHaveCount(0);

  // ZIP-321 asks wallets to refuse a malformed link rather than pick one reading of it.
  for (const link of [
    `zcash:${UA}?amount=0.1&amount=10`,
    `zcash:${UA}?address=${T1}&amount=1`,
    `zcash:${UA}?amount=0.123456789`,
    `zcash:${UA}?memo=SGk=`,
  ]) {
    await to.fill(link);
    await expect(page.getByText('This payment link is not valid.')).toBeVisible();
    await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(confirm).toHaveCount(0);

  // Typing a link by hand does not wipe it at the colon.
  await to.fill('');
  await to.pressSequentially('zcash:');
  await expect(to).toHaveValue('zcash:');
});

test('a memo goes with a shielded payment and shows in History', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const to = page.getByLabel('Recipient address');
  const memo = page.getByLabel('Memo (optional)');
  const count = page.getByTestId('memo-count');
  const unavailable = page.getByText('This address cannot receive a memo');

  // No field until the recipient is known to take a memo.
  await expect(memo).toHaveCount(0);
  await to.fill(UA);
  await expect(count).toHaveText('0 / 512 bytes');
  await expect(memo).toHaveAccessibleDescription(/only you and the recipient can read it.*0 \/ 512 bytes/);

  // The counter counts bytes: 29 characters, but "ç", "ş" and "ü" take two each.
  await memo.fill('Fatura #4521 için\nteşekkürler');
  await expect(count).toHaveText('32 / 512 bytes');

  // Transparent and TEX recipients get a note instead of the field.
  for (const address of [T1, TEX]) {
    await to.fill(address);
    await expect(memo).toHaveCount(0);
    await expect(unavailable).toBeVisible();
  }
  await to.fill(UA);
  await expect(unavailable).toHaveCount(0);
  await expect(memo).toHaveValue('Fatura #4521 için\nteşekkürler');

  // Too long is caught before Review, on the field itself.
  await memo.fill('ş'.repeat(257));
  await expect(count).toHaveText('514 / 512 bytes');
  await page.getByLabel('Amount (ZEC)').fill('0.1');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(memo).toBeFocused();
  await expect(memo).toHaveAttribute('aria-invalid', 'true');
  await expect(memo).toHaveAccessibleDescription(/too long: at most 512 bytes/);
  await expect(page.getByRole('heading', { name: 'Confirm sending' })).toHaveCount(0);
  await memo.fill('a\u0000b');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(memo).toHaveAccessibleDescription(/NUL character/);

  // The confirm screen and the result show the memo; History shows it on the sent payment.
  await memo.fill('Fatura #4521 için\nteşekkürler');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByTestId('confirm-memo')).toHaveText('Fatura #4521 için\nteşekkürler');
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('confirm-memo')).toHaveText('Fatura #4521 için\nteşekkürler');
  await page.getByRole('button', { name: 'View in history' }).click();
  await expect(page.getByTestId('history').locator('.tx-sent .tx-memo')).toHaveText('“Fatura #4521 için\nteşekkürler”');
});

test('a memo typed for a shielded address is not sent to a transparent one', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Memo (optional)').fill('for the shielded address');
  // The fake engine, like WebZjs, refuses a memo to a transparent address.
  await review(page, T1, '0.1');
  await expect(page.getByTestId('confirm-memo')).toHaveCount(0);
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'View in history' }).click();
  await expect(page.getByTestId('history').locator('.tx-sent')).toHaveCount(1);
  await expect(page.getByTestId('history').locator('.tx-sent .tx-memo')).toHaveCount(0);
});

test('a payment link fills in its memo, and only for its own recipient', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const to = page.getByLabel('Recipient address');
  const amount = page.getByLabel('Amount (ZEC)');
  const memo = page.getByLabel('Memo (optional)');
  const amountNote = page.getByText('Amount filled in from the payment link.');
  const memoNote = page.getByText('Memo filled in from the payment link.');

  await to.fill(`zcash:${UA}?amount=0.25&memo=${linkMemo('Sipariş 7781')}&message=thanks`);
  await expect(to).toHaveValue(UA);
  await expect(amount).toHaveValue('0.25');
  await expect(memo).toHaveValue('Sipariş 7781');
  await expect(amountNote).toBeVisible();
  await expect(memoNote).toBeVisible();

  // Max replaces the link's amount, so the note no longer credits the link.
  await page.getByRole('button', { name: 'Max' }).click();
  await expect(amount).toHaveValue('1.2499');
  await expect(amountNote).toHaveCount(0);
  await expect(memoNote).toBeVisible();

  // Another link replaces what the first one filled in, and keeps what was typed.
  await amount.fill('0.3');
  await to.fill(`zcash:${UA}?memo=${linkMemo('Sipariş 9000')}`);
  await expect(amount).toHaveValue('0.3');
  await expect(memo).toHaveValue('Sipariş 9000');
  await to.fill(`zcash:${UA}?amount=0.5`);
  await expect(amount).toHaveValue('0.5');
  await expect(memo).toHaveValue('');
  await expect(memoNote).toHaveCount(0);

  // A different recipient drops the amount a link asked for someone else.
  await to.fill(T1);
  await expect(amount).toHaveValue('');
  await expect(amountNote).toHaveCount(0);

  // The memo link is paid with its memo.
  await to.fill(`zcash:${UA}?amount=0.2&memo=${linkMemo('Sipariş 7781')}`);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByTestId('confirm-memo')).toHaveText('Sipariş 7781');
  await expect(page.getByTestId('confirm-amount')).toHaveText('0.20 ZEC');
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

  // Opened from Send, Shield keeps Send marked and returns there.
  const sendTab = page.getByRole('button', { name: 'Send', exact: true });
  await page.getByRole('button', { name: 'Shield funds' }).click();
  await expect(page.getByRole('heading', { name: 'Shield funds' })).toBeVisible();
  await expect(sendTab).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByRole('heading', { name: 'Send ZEC' })).toBeFocused();
  await expect(sendTab).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Shield funds' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Shield', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0.50 ZEC is being shielded' })).toBeVisible({ timeout: 10_000 });
  await expect(sendTab).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Send ZEC' })).toBeVisible();
  await expect(sendTab).toHaveAttribute('aria-current', 'page');
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

  await page.getByLabel('Alıcı adresi').fill(`zcash:${UA}?amount=1.001&memo=${linkMemo('Teşekkürler')}`);
  await expect(amount).toHaveValue('1,001');
  await expect(page.getByLabel('Not (isteğe bağlı)')).toHaveValue('Teşekkürler');
  await expect(page.getByTestId('memo-count')).toHaveText('13 / 512 bayt');
  await expect(page.getByText('Not ödeme bağlantısından dolduruldu.')).toBeVisible();
  await page.getByLabel('Alıcı adresi').fill(T1);
  await expect(page.getByText('Bu adres not alamaz')).toBeVisible();
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
