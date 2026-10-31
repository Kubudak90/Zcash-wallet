import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { expect, test, type Page } from '@playwright/test';

import { currentMonth } from '../../src/lib/birthday';
import { CLEAR_AFTER_MS } from '../../src/lib/clipboard';
import { PASSWORD, UA, createWallet, fakeEngine, nav, setKnobs } from './helpers';

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
  // Shown, the rule under the figure splits shielded from transparent by their sizes.
  const split = page.locator('main .split > span');
  await expect(split).toHaveCount(2);
  await expect(page.locator('main [style*="flex-grow"]')).toHaveCount(2);
  // And Recent activity sizes its fraction column to the widest amount.
  await expect(page.locator('main [style*="--tx-frac"]')).toHaveCount(1);

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
  // Hidden, the rule is one plain segment: no share of either pool is drawn.
  await expect(split).toHaveCount(1);
  await expect(split).toHaveClass('split-none');
  await expect(page.locator('main [style*="flex-grow"]')).toHaveCount(0);
  // Nor does the activity list's layout say how many decimals its amounts have.
  await expect(page.locator('main [style*="--tx-frac"]')).toHaveCount(0);
  await expect(page.getByText('•••• ZEC sits on a public transparent address.')).toBeVisible();
  // The threshold is the network's, not the wallet's, and stays readable.
  await expect(page.locator('main')).not.toContainText(/1[.,]75|1[.,]25|0[.,]50/);

  // Kept across a lock, which reloads the page.
  await page.getByRole('button', { name: 'Lock' }).click();
  await unlock(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('balance-total')).not.toContainText(/\d/);

  // History and the Send form's balance hints are masked too.
  await nav(page, 'History');
  const received = page.getByTestId('history').locator('.tx').first();
  await expect(received.locator('.tx-amount [aria-hidden="true"]')).toHaveText('+••••');
  await expect(page.getByTestId('history')).not.toContainText(/\d[.,]\d{2}/);
  await nav(page, 'Send');
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
  await nav(page, 'Balance');
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
    await nav(page, 'Settings');
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
    await nav(page, 'Receive');
    await page.getByRole('button', { name: 'Copy' }).click();
    const address = (await page.getByTestId('receive-address').textContent())!;
    await page.clock.fastForward(2 * CLEAR_AFTER_MS);
    expect(await clipboardText(page)).toBe(address);
  });

  test('copied by hand, it is cleared too; other text copied by hand is not', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    await nav(page, 'Settings');
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

test.describe('a recovery phrase copied by hand (review round 7, VAULT-4)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

  test('is cleared from the clipboard a minute later while creating the wallet', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new wallet' }).click();
    await page.getByRole('button', { name: 'Reveal words' }).click();
    const grid = page.getByTestId('seed-grid');
    await grid.selectText();
    await page.keyboard.press('ControlOrMeta+C');
    const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
    const copied = await clipboardText(page);
    for (const w of words) expect(copied).toContain(w);
    await expect(page.getByTestId('clipboard-note-seed')).toHaveText(/clear the clipboard/);
    await page.clock.fastForward(CLEAR_AFTER_MS + 1_000);
    await expect.poll(() => clipboardText(page)).toBe('');
    await expect(page.getByTestId('clipboard-note-seed')).toHaveText('Clipboard cleared.');
  });

  test('in Settings, and the note shows under the phrase, not under the viewing key', async ({ page }) => {
    await page.clock.install();
    await createWallet(page);
    await nav(page, 'Settings');
    await page.getByRole('button', { name: 'Show viewing key' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByTestId('clipboard-note-viewing-key')).toHaveText(/clear the clipboard/);

    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByTestId('seed-grid').selectText();
    await page.keyboard.press('ControlOrMeta+C');
    expect(await clipboardText(page)).toMatch(/[a-z]+/);
    await expect(page.getByTestId('clipboard-note-seed')).toHaveText(/clear the clipboard/);
    await expect(page.getByTestId('clipboard-note-viewing-key')).toHaveText('');
    await page.clock.fastForward(CLEAR_AFTER_MS + 1_000);
    await expect.poll(() => clipboardText(page)).toBe('');
  });
});

test('the eye is named in Turkish too', async ({ page }) => {
  await createWallet(page);
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await nav(page, 'Bakiye');
  await page.getByRole('button', { name: 'Bakiyeleri gizle' }).click();
  await expect(page.getByTestId('balance-total').locator('.visually-hidden')).toHaveText('tutar gizlendi');
  await expect(page.getByText('•••• ZEC herkesin görebildiği şeffaf adreste duruyor.', { exact: false })).toBeVisible();
});

const enhancement = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fakeEngine?: { historyEnhancement?: boolean } }).__fakeEngine?.historyEnhancement);

test('fetching full transactions for History can be turned off, and stays off across a lock', async ({ page }) => {
  // Verifier finding V-6, owner decision: the switch, default on, with what each side costs.
  await createWallet(page);
  // On by default, and the engine is told so before any wallet opens.
  expect(await enhancement(page)).toBe(true);
  await nav(page, 'Settings');
  const box = page.getByRole('checkbox', { name: 'Fetch full transactions for History' });
  await expect(box).toBeChecked();
  await expect(box).toHaveAccessibleDescription(/The server then learns which transactions are yours\./);
  await expect(box).toHaveAccessibleDescription(/History shows no memos and, after a restore, past payments by their net amount only/);
  const server = page.getByLabel('Server (lightwalletd gRPC-web proxy)');
  await expect(server).toHaveAccessibleDescription(/Unless you turn off “Fetch full transactions for History” under Privacy/);

  await box.uncheck();
  await expect.poll(() => enhancement(page)).toBe(false);
  // Saved with the settings: the next page (after a lock) tells the engine again.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  expect(await enhancement(page)).toBe(false);
  await unlock(page);
  await nav(page, 'Settings');
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(() => enhancement(page)).toBe(true);

  await page.getByRole('button', { name: 'Türkçe' }).click();
  const kutu = page.getByRole('checkbox', { name: 'Geçmiş için işlemlerin tamamını getir' });
  await expect(kutu).toBeChecked();
  await expect(kutu).toHaveAccessibleDescription(/Sunucu böylece hangi işlemlerin senin olduğunu öğrenir\./);
});

test('a restore can start with full transactions for History off, before its first pass', async ({ page }) => {
  // Final review V2-4: the switch was only in Settings, so a restore began with it on and the
  // first pass could ask for the wallet's past transactions before anyone reached Settings.
  await fakeEngine(page, { holdPass: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore an existing wallet' }).click();
  await page.getByRole('textbox').fill(generateMnemonic(wordlist, 256));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Month', { exact: true }).fill(currentMonth());
  const box = page.getByRole('checkbox', { name: 'Fetch full transactions for History' });
  // The browser's setting (on unless turned off), and what it costs.
  await expect(box).toBeChecked();
  await expect(box).toHaveAccessibleDescription(/so the server learns which transactions are yours/);
  await expect(box).toHaveAccessibleDescription(/You can change this later under Settings > Privacy\./);
  await box.uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Going back keeps the choice; nothing is saved before the wallet is created.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(box).not.toBeChecked();
  expect(await enhancement(page)).toBe(true);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();
  // Off before the first pass has scanned a block (it waits at its start).
  await expect(page.getByTestId('sync-status')).toHaveText(/Syncing|Connecting/);
  expect(await enhancement(page)).toBe(false);
  await nav(page, 'Settings');
  await expect(page.getByRole('checkbox', { name: 'Fetch full transactions for History' })).not.toBeChecked();
  await setKnobs(page, { holdPass: false });
  // Saved with the browser's settings: still off after a lock.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  expect(await enhancement(page)).toBe(false);
});

test('the restore switch in Turkish', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Var olan cüzdanı geri yükle' }).click();
  await page.getByRole('textbox').fill(generateMnemonic(wordlist, 256));
  await page.getByRole('button', { name: 'Devam' }).click();
  const kutu = page.getByRole('checkbox', { name: 'Geçmiş için işlemlerin tamamını getir' });
  await expect(kutu).toBeChecked();
  await expect(kutu).toHaveAccessibleDescription(/Bunu daha sonra Ayarlar > Gizlilik’ten değiştirebilirsin\./);
});

test('a restore from an old month says the first scan takes hours, without stopping it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore an existing wallet' }).click();
  await page.getByRole('textbox').fill(generateMnemonic(wordlist, 256));
  await page.getByRole('button', { name: 'Continue' }).click();
  const month = page.getByLabel('Month', { exact: true });
  const notice = page.getByTestId('long-scan');
  const old = `${new Date().getFullYear() - 2}-01`;

  // This month: no notice.
  await month.fill(currentMonth());
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await expect(notice).toHaveCount(0);
  // Two years back: well over 500,000 blocks.
  await month.fill(old);
  await expect(notice).toContainText(new RegExp(`^Starting from ${old} means scanning about [\\d,]+ blocks\\. The first scan can take hours`));
  await expect(notice).toContainText('needs several GB of memory');
  await expect(notice).toContainText('choose the latest month you are sure of');
  await expect(month).toHaveAccessibleDescription(/means scanning about/);
  const blocks = Number((await notice.textContent())!.match(/about ([\d,]+) blocks/)![1]!.replace(/,/g, ''));
  expect(blocks).toBeGreaterThan(500_000);
  // It does not stop the restore.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Sync will start at block/)).toBeVisible();
});

test('the old-month notice in Turkish', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByRole('button', { name: 'Var olan cüzdanı geri yükle' }).click();
  await page.getByRole('textbox').fill(generateMnemonic(wordlist, 256));
  await page.getByRole('button', { name: 'Devam' }).click();
  const old = `${new Date().getFullYear() - 2}-01`;
  await page.getByLabel('Ay', { exact: true }).fill(old);
  await expect(page.getByTestId('long-scan')).toContainText(
    new RegExp(`^${old} ile başlamak yaklaşık [\\d.]+ blok taramak demek\\. İlk tarama saatler sürebilir`),
  );
  await expect(page.getByTestId('long-scan')).toContainText('emin olduğun en son ayı seç');
  await expect(page.getByRole('button', { name: 'Devam' })).toBeEnabled();
});
