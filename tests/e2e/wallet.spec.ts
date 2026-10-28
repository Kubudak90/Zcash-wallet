import { bech32m } from '@scure/base';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Gizli-Parola-2026';
// A valid-checksum unified address (example from the WebZjs docs).
const UA =
  'u18rakpts0de589sx9dkamcjms3apruqqax9k2s6e7zjxx9vv5kc67pks2trg9d3nrgd5acu8w8arzjjuepakjx38dyxl6ahd948w0mhdt9jxqsntan6px3ysz80s04a87pheg2mqvlzpehrgup7568nfd6ez23xd69ley7802dfvplnfn7c07vlyumcnfjul4pvv630ac336rjhjyak5';

async function createWallet(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new wallet' }).click();
  await page.getByRole('button', { name: 'Reveal words' }).click();

  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
  expect(words).toHaveLength(24);

  await page.getByLabel('I wrote the words down in order').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  for (const label of await page.locator('form .field > span').allTextContents()) {
    const n = Number(label.replace('Word #', ''));
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Up to date', { timeout: 20_000 });
  return words;
}

test('create, receive, send, shield, lock and unlock', async ({ page }) => {
  await createWallet(page);

  await expect(page.getByTestId('balance-total')).toContainText('1.75');
  await expect(page.getByTestId('balance-shielded')).toContainText('1.25');
  await expect(page.getByTestId('balance-transparent')).toContainText('0.50');

  // Receive: shielded unified address by default, transparent on request.
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByTestId('receive-address')).toHaveText(/^u1/);
  await page.getByRole('button', { name: 'Show transparent address' }).click();
  await expect(page.getByTestId('receive-address')).toHaveText(/^t1/);

  // Send: client-side validation first.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill('u1notarealaddress');
  await page.getByLabel('Amount (ZEC)').fill('5');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByText('This is not a valid Zcash address.')).toBeVisible();
  await expect(page.getByText('does not cover this amount plus the fee')).toBeVisible();

  // A zcash: payment link fills both fields.
  await page.getByLabel('Recipient address').fill(`zcash:${UA}?amount=0.5`);
  await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByTestId('confirm-amount')).toHaveText('0.50 ZEC');

  await page.getByLabel('Enter your password to confirm').fill('wrong-password');
  await page.getByRole('button', { name: 'Send', exact: true }).first().click();
  await expect(page.getByText('Wrong password.')).toBeVisible();

  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.stages').getByText('Generating zero-knowledge proofs')).toBeVisible();
  await expect(page.getByRole('heading', { name: '0.50 ZEC sent' })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByTestId('history');
  await expect(history.locator('.tx').first()).toContainText('Sent');
  await expect(history.locator('.tx').first()).toContainText('-0.5001');
  await expect(history).toContainText('Received');

  // Shield the transparent balance.
  await page.getByRole('button', { name: 'Balance' }).click();
  await expect(page.getByText('You have a transparent balance')).toBeVisible();
  await page.getByRole('button', { name: 'Shield funds' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Shield', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0.50 ZEC is being shielded' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('balance-transparent')).toContainText('0.00');

  // Lock, then unlock: state survives through the encrypted database.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  await page.getByLabel('Password').fill('nope-nope-nope');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Wrong password.')).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('balance-shielded')).toContainText('0.7499');
});

test('nothing secret is stored in plaintext', async ({ page }) => {
  const words = await createWallet(page);
  const dump = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('celari');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('kv', 'readonly');
    const all = await new Promise<unknown[]>((resolve) => {
      const req = tx.objectStore('kv').getAll();
      req.onsuccess = () => resolve(req.result);
    });
    return JSON.stringify(all);
  });
  expect(dump).toContain('"kdf"');
  // Single words prove nothing: BIP39 words such as "seed", "salt" or "secret"
  // are also field names and values here. A stored phrase, as text or as a
  // JSON array, always contains two of its words side by side.
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]];
    expect(dump).not.toContain(`${a} ${b}`);
    expect(dump).not.toContain(`"${a}","${b}"`);
  }
});

test('settings: reveal recovery phrase and viewing key, then wipe', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const words = await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();

  // The server field and the auto-lock select are named by their headings.
  const server = page.getByLabel('Server (lightwalletd gRPC-web proxy)');
  await expect(server).toHaveValue(/^https:/);
  await expect(server).toHaveAccessibleDescription(/can see your IP address/);
  await server.fill('http://insecure.example');
  await expect(server).toHaveAttribute('aria-invalid', 'true');
  await expect(server).toHaveAccessibleDescription(/valid address starting with https/);
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(server).toHaveAttribute('aria-invalid', 'false');
  await page.getByLabel('Auto-lock').selectOption('30');
  await expect(page.getByLabel('Auto-lock')).toHaveValue('30');

  const security = page.locator('.settings-group', { has: page.getByRole('heading', { name: 'Security' }) });
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.locator('[data-testid="seed-grid"] .seed-word').first()).toHaveText(words[0]!);
  // The onboarding warnings come with the phrase here too.
  await expect(security.locator('.notice-warn')).toContainText('Never share them');
  await expect(security.locator('.notice-warn')).toContainText('Do not screenshot them');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(security.locator('.notice-warn')).toBeHidden();

  await page.getByRole('button', { name: 'Show viewing key' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.getByTestId('viewing-key')).toHaveText(/^uview1/);
  await expect(security).toContainText('It cannot be revoked');
  await expect(security).not.toContainText('accountant');
  await security.getByRole('button', { name: 'Copy' }).click();
  await expect(security.getByRole('button', { name: 'Copied' })).toBeVisible();
  const key = await page.getByTestId('viewing-key').textContent();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  const wipe = page.getByRole('button', { name: 'Remove wallet from this browser' });
  await expect(wipe).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await wipe.click();
  await expect(page.getByRole('button', { name: 'Create a new wallet' })).toBeVisible();
});

test('restore view-only wallet from a viewing key', async ({ page }) => {
  const ufvk = bech32m.encode('uview', bech32m.toWords(new Uint8Array(120).fill(9)), false);
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore an existing wallet' }).click();

  await page.getByRole('textbox').fill('one two three');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This is not a valid recovery phrase.')).toBeVisible();

  await page.getByRole('tab', { name: 'View only' }).click();
  await page.getByRole('textbox').fill(ufvk);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Month').fill('2025-03');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Sync will start at block/)).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();

  await expect(page.getByText('View only', { exact: true })).toBeVisible();
  await expect(page.getByText('You have a transparent balance')).toBeHidden();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('You are in view-only mode')).toBeVisible();
});

test('Turkish interface', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(page.getByRole('button', { name: 'Yeni cüzdan oluştur' })).toBeVisible();
  await expect(page.getByText('Açık kaynak · Token yok · Airdrop vaadi yok')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});
