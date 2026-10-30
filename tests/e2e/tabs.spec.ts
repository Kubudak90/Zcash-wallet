import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, createWallet, fillVerification, nav } from './helpers';

// One page at a time opens the wallet (review round 7: PLAT-1, VAULT-2, SPEND-5). Every
// page keeps its own copy of the wallet database and saves it over the stored one, so two
// open pages overwrote each other, showed the same "new" address, wrote a removed wallet
// back, and a page left on Welcome replaced a stored wallet without the "Remove wallet"
// warning. Two pages of one browser context share IndexedDB and Web Locks, like two tabs.

const OTHER_TAB =
  'Celari has a wallet open in another tab or window of this browser. Lock or close it there, then try again. Nothing was changed.';
const WALLET_EXISTS =
  'Another tab added a wallet to this browser meanwhile, so this one was not saved and nothing was changed. Reload the page to open that wallet. To replace it, remove it first, from its lock screen or in Settings.';

const lockScreen = (page: Page) => page.getByRole('heading', { name: 'Your wallet is locked' });
const welcome = (page: Page) => page.getByRole('button', { name: 'Create a new wallet' });

async function unlock(page: Page) {
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

async function lock(page: Page) {
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(lockScreen(page)).toBeVisible();
}

/** The wallet's entries in Celari's IndexedDB store (settings left out), with their values. */
function walletEntries(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('celari');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction('kv', 'readonly').objectStore('kv');
          const out: Record<string, unknown> = {};
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) {
              open.result.close();
              resolve(out);
              return;
            }
            if (c.key !== 'settings') out[String(c.key)] = c.value;
            c.continue();
          };
          cursor.onerror = () => reject(cursor.error);
        };
      }),
  );
}

/** Goes through Create on a page already showing Welcome, up to "Create wallet". */
async function createHere(page: Page) {
  await welcome(page).click();
  await page.getByRole('button', { name: 'Reveal words' }).click();
  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
  await page.getByLabel('I wrote the words down in order').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await fillVerification(page, words);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();
}

test('a second tab cannot open the wallet while the first has it open, and can once it locks', async ({ context, page }) => {
  await createWallet(page);
  const other = await context.newPage();
  await other.goto('/');
  await expect(lockScreen(other)).toBeVisible();

  // The right password, but the first tab has the wallet open: nothing opens here.
  await unlock(other);
  await expect(other.getByText(OTHER_TAB)).toBeVisible();
  await expect(other.getByTestId('balance-total')).toHaveCount(0);

  // Locking reloads the first tab and lets go: now the second one opens it, and the first cannot.
  await lock(page);
  await unlock(other);
  await expect(other.getByTestId('balance-total')).toBeVisible();
  await unlock(page);
  await expect(page.getByText(OTHER_TAB)).toBeVisible();

  // Locking and unlocking again in the tab that has it open still works (the lock comes back after the reload).
  await lock(other);
  await unlock(other);
  await expect(other.getByTestId('balance-total')).toBeVisible();
});

test('a tab left on Welcome cannot replace a wallet another tab stored', async ({ context, page }) => {
  // Opened before any wallet existed: Welcome never locks or reloads.
  const stale = await context.newPage();
  await stale.goto('/');
  await expect(welcome(stale)).toBeVisible();

  await createWallet(page);
  const stored = await walletEntries(page);
  expect(Object.keys(stored).sort()).toEqual(['db', 'meta', 'vault']);

  // While the wallet is open in the first tab.
  await createHere(stale);
  await expect(stale.getByText(OTHER_TAB)).toBeVisible();
  expect((await walletEntries(page)).vault).toEqual(stored.vault);

  // Locked there, so no page has it open: still not replaced, without the typed confirmation of "Remove wallet".
  await lock(page);
  await stale.getByRole('button', { name: 'Create wallet' }).click();
  await expect(stale.getByText(WALLET_EXISTS)).toBeVisible();
  const after = await walletEntries(page);
  expect(after.vault).toEqual(stored.vault);
  expect(after.meta).toEqual(stored.meta);

  // The first wallet still opens, with its own password and database.
  await unlock(page);
  await expect(page.getByTestId('balance-total')).toBeVisible();
});

test('a wallet removed in another tab is not written back by the tab that had it open', async ({ context, page }) => {
  await createWallet(page);
  const other = await context.newPage();
  await other.goto('/');
  await expect(lockScreen(other)).toBeVisible();

  // Removed from the lock screen of the second tab.
  await other.getByRole('button', { name: 'I forgot my password' }).click();
  await other.getByLabel('Type DELETE to confirm').fill('DELETE');
  await other.getByRole('button', { name: 'Remove wallet from this browser' }).click();
  await expect(welcome(other)).toBeVisible();
  expect(await walletEntries(other)).toEqual({});

  // The first tab saves (each opening of Receive hands out and saves a new address): it finds
  // the wallet gone, writes nothing and reloads to Welcome.
  await nav(page, 'Receive');
  await expect(welcome(page)).toBeVisible();
  expect(await walletEntries(page)).toEqual({});
});
