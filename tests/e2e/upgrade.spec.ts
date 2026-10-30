import { expect, test, type Page } from '@playwright/test';

import { OLD_ENGINE, PASSWORD, TIP, createWallet, en, fakeEngine, nav, restoreFromThisMonth, setKnobs } from './helpers';

// Opening the stored wallet database on unlock (review finding R2). Only a database in the
// format of the engine before the port is rebuilt from the secret, and the old blob is kept
// under db-legacy until a pass that reaches the tip has been saved; any other error, and a
// database from a newer Celari, leave everything as it is.

// Verifier finding M2: the in-app notice says that the rescan pauses whenever Celari locks.
const upgradeApp = (minutes: number) =>
  `Celari was updated for the new Zcash network rules and is rescanning this wallet from its starting block. This can take a while, an hour or more for an older wallet, and it runs only while Celari is unlocked: it pauses whenever the wallet locks (after ${minutes} minutes without activity, or 1 minute in a background tab) and goes on when you unlock. Keep this tab open and in front, or raise the auto-lock time in Settings until it is done. Your funds are safe; the balance and history fill in as the scan goes on.`;
const UPGRADE_APP = upgradeApp(15);
const UPGRADE_LOCK =
  'Celari was updated for the new Zcash network rules and is rescanning this wallet from its starting block. This can take a while, and it goes on while the wallet is unlocked. Your funds are safe.';
const UNREADABLE =
  'Celari could not read this wallet’s saved data, so it changed nothing; your funds are safe. Reload the page and try again. If it keeps failing, you can remove the wallet from this browser and restore it from your recovery phrase.';
const NEWER =
  'This wallet was saved by a newer version of Celari than the one running now, which cannot open it. Nothing was changed and your funds are safe. Reload the page to get the newer version.';

/** A value of Celari's IndexedDB store ('celari' / 'kv'), as structured-cloned data. */
function idb(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('celari');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('kv', 'readonly').objectStore('kv').get(k);
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    key,
  );
}

/** Writes a value into Celari's IndexedDB store. */
function idbPut(page: Page, key: string, value: unknown): Promise<void> {
  return page.evaluate(
    ([k, v]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('celari');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(v, k as string);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [key, value] as const,
  );
}

const status = (page: Page) => page.getByTestId('sync-status');
const lockScreen = (page: Page) => page.getByRole('heading', { name: 'Your wallet is locked' });

async function unlock(page: Page) {
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** Locks (a reload once no pass runs) and waits for the lock screen. */
async function lock(page: Page) {
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(lockScreen(page)).toBeVisible();
}

test('an old-format database is kept as db-legacy, the wallet is rebuilt and rescanned, and the copy goes once a pass reaches the tip', async ({
  page,
}) => {
  test.slow();
  const rebuilds: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('rebuilding the wallet database')) rebuilds.push(m.text());
  });
  // The engine before the port writes its own format.
  await fakeEngine(page, { ...OLD_ENGINE, oldDbFormat: true });
  const birthday = await restoreFromThisMonth(page);
  await expect(status(page)).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
  const old = await idb(page, 'db');
  // The metadata as Celari before the port wrote it: no account id.
  const { accountId: _, ...oldMeta } = (await idb(page, 'meta')) as Record<string, unknown>;
  await idbPut(page, 'meta', oldMeta);
  expect(await idb(page, 'db-legacy')).toBeUndefined();

  // Celari is updated: the ported engine does not read that format. Its passes wait for now.
  await fakeEngine(page, { holdPass: true });
  await lock(page);
  await expect(page.getByText(UPGRADE_LOCK)).toHaveCount(0);
  await unlock(page);
  await expect(status(page)).toBeVisible();
  expect(rebuilds).toHaveLength(1);
  // The old blob is kept, the new database names its account in the metadata.
  expect(await idb(page, 'db-legacy')).toEqual(old);
  expect(await idb(page, 'db')).not.toEqual(old);
  expect(await idb(page, 'meta')).toEqual({ ...oldMeta, accountId: 0 });
  await expect(page.getByTestId('upgrade-rescan')).toHaveText(UPGRADE_APP);
  // The rescan starts at the birthday.
  await expect(status(page)).toHaveText(`Syncing · ${en(TIP - (birthday - 1))} blocks left`);
  await nav(page, 'History');
  await expect(page.getByTestId('upgrade-rescan')).toHaveText(UPGRADE_APP);
  // It names the auto-lock time in force: raised to 60 minutes, it says so.
  await nav(page, 'Settings');
  await page.locator('select[name="auto-lock"]').selectOption('60');
  await expect(page.getByTestId('upgrade-rescan')).toHaveText(upgradeApp(60));

  // Locked meanwhile: the lock screen says so too.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(lockScreen(page)).toBeVisible();
  await expect(page.getByText(UPGRADE_LOCK)).toBeVisible();
  await unlock(page);
  await expect(page.getByTestId('upgrade-rescan')).toBeVisible();

  // A pass that ends behind the tip (here, the server is 50 blocks ahead) keeps the copy.
  await setKnobs(page, { holdPass: false, tipAhead: 50 });
  await expect(status(page)).toHaveText('Syncing · 50 blocks left', { timeout: 20_000 });
  expect(await idb(page, 'db-legacy')).toEqual(old);
  await expect(page.getByTestId('upgrade-rescan')).toBeVisible();

  // The next pass reaches the tip and is saved: the copy goes, and the notice with it. (The
  // chain grows to the tip that server showed, and the passes now scan up to it.)
  await setKnobs(page, { tipAhead: 0, chainGrowth: 50 });
  await expect(status(page)).toHaveText(`Up to date · block ${en(TIP + 50)}`, { timeout: 45_000 });
  await expect.poll(() => idb(page, 'db-legacy')).toBeUndefined();
  await expect(page.getByTestId('upgrade-rescan')).toHaveCount(0);
  await nav(page, 'Balance');
  await expect(page.getByTestId('balance-total')).toContainText('1.75');

  // Nothing is rebuilt again, and the lock screen says nothing of a rescan.
  await lock(page);
  await expect(page.getByText(UPGRADE_LOCK)).toHaveCount(0);
  await unlock(page);
  await expect(page.getByTestId('balance-total')).toContainText('1.75');
  await expect(page.getByTestId('upgrade-rescan')).toHaveCount(0);
  expect(rebuilds).toHaveLength(1);
});

test('the rescan notices in Turkish', async ({ page }) => {
  await fakeEngine(page, { ...OLD_ENGINE, oldDbFormat: true });
  await createWallet(page);
  await fakeEngine(page, { holdPass: true });
  await lock(page);
  await unlock(page);
  await expect(page.getByTestId('upgrade-rescan')).toBeVisible();
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(page.getByTestId('upgrade-rescan')).toHaveText(
    'Celari yeni Zcash ağ kuralları için güncellendi ve bu cüzdanı başlangıç bloğundan itibaren yeniden tarıyor. Bu biraz sürebilir, eski bir cüzdanda bir saati aşabilir; tarama yalnızca Celari’nin kilidi açıkken ilerler: cüzdan kilitlendiğinde (15 dakika işlem yapılmayınca ya da sekme 1 dakika arka planda kalınca) durur, kilidi açınca devam eder. Bitene kadar bu sekmeyi açık ve önde tut ya da Ayarlar’dan otomatik kilit süresini uzat. Paran güvende; bakiye ve geçmiş tarama ilerledikçe tamamlanır.',
  );
  // A pass is held, but a new wallet is not catching up: the lock reloads at once.
  await page.getByRole('button', { name: 'Kilitle' }).click();
  await expect(page.getByRole('heading', { name: 'Cüzdanın kilitli' })).toBeVisible();
  await expect(
    page.getByText(
      'Celari yeni Zcash ağ kuralları için güncellendi ve bu cüzdanı başlangıç bloğundan itibaren yeniden tarıyor. Bu biraz sürebilir; tarama cüzdan açıkken sürer. Paran güvende.',
    ),
  ).toBeVisible();
});

test('any other error opening the database changes nothing and says so', async ({ page }) => {
  await createWallet(page);
  const db = await idb(page, 'db');
  const meta = await idb(page, 'meta');
  // E.g. a wasm trap or running out of memory while the blob is decoded.
  await fakeEngine(page, { openFails: 'RuntimeError: unreachable executed' });
  await lock(page);
  await unlock(page);
  await expect(page.locator('.notice-error').or(status(page))).toBeVisible();
  // Nothing stored was touched.
  expect(await idb(page, 'db')).toEqual(db);
  expect(await idb(page, 'meta')).toEqual(meta);
  expect(await idb(page, 'db-legacy')).toBeUndefined();
  await expect(page.getByText(UNREADABLE)).toBeVisible();
  await page.getByText('Details').click();
  await expect(page.getByText('RuntimeError: unreachable executed')).toBeVisible();
  await expect(lockScreen(page)).toBeVisible();

  // Once the engine can read it again, everything is there.
  await fakeEngine(page, {});
  await page.reload();
  await unlock(page);
  await expect(page.getByTestId('balance-total')).toContainText('1.75');
});

test('a database saved by a newer Celari is left as it is', async ({ page }) => {
  await fakeEngine(page, { newerDbFormat: true });
  await createWallet(page);
  const db = await idb(page, 'db');
  // Rolled back to this version.
  await fakeEngine(page, {});
  await lock(page);
  await unlock(page);
  await expect(page.locator('.notice-error').or(status(page))).toBeVisible();
  expect(await idb(page, 'db')).toEqual(db);
  expect(await idb(page, 'db-legacy')).toBeUndefined();
  await expect(page.getByText(NEWER)).toBeVisible();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Kilidi aç' }).click();
  await expect(
    page.getByText(
      'Bu cüzdan, şu an çalışan sürümden daha yeni bir Celari sürümüyle kaydedilmiş; bu sürüm onu açamıyor. Hiçbir şey değiştirilmedi, paran güvende. Yeni sürümü almak için sayfayı yenile.',
    ),
  ).toBeVisible();
});

test('a wallet saved before its first pass ended unlocks without a rebuild', async ({ page }) => {
  const rebuilds: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('rebuilding')) rebuilds.push(m.text());
  });
  // A restore is saved with its account at once; its first pass is held.
  await fakeEngine(page, { holdPass: true });
  await restoreFromThisMonth(page);
  await expect(status(page)).toHaveText(/^Syncing · [\d,]+ blocks left$/);
  const db = await idb(page, 'db');
  // The tab is closed (here: reloaded) during that pass, so nothing more was saved. The
  // engine has no summary for the database, and so names no account.
  await fakeEngine(page, {});
  await page.reload();
  await unlock(page);
  await expect(page.locator('.notice-error').or(status(page))).toBeVisible();
  expect(await page.locator('.notice-error').allTextContents(), 'the unlock failed').toEqual([]);
  await expect(status(page)).toHaveText(`Up to date · block ${en(TIP)}`, { timeout: 20_000 });
  await expect(page.getByTestId('balance-total')).toContainText('1.75');
  expect(rebuilds).toEqual([]);
  expect(await idb(page, 'db')).not.toEqual(db); // saved after the pass, not replaced before it
  expect(await idb(page, 'db-legacy')).toBeUndefined();
});
