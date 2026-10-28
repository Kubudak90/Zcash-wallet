import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet, fakeEngine, setKnobs } from './helpers';

// The network guard on the fake engine: by default it reports rules it
// supports; networkOutdated reports NU6.3 (Ironwood), which it does not, like
// the WebZjs Celari ships today (src/engine/fake.ts).

const NU7 = { name: 'NU7', height: 3_543_405, supported: false };

const banner = (page: Page) => page.getByTestId('network-banner');
const pill = (page: Page) => page.getByTestId('sync-status');
const NU7_NOTICE =
  'At block 3,543,405 the network switches to NU7, which this version of Celari does not support. From then on, sending and shielding stop until Celari is updated.';
const SERVER_BEHIND =
  'The server Celari uses is behind the Zcash network. Choose another server in Settings. Sending and shielding stay disabled until then.';

/** Waits until the fake engine has answered another network check (one comes with every sync pass). */
async function nextNetworkCheck(page: Page) {
  const checks = () => page.evaluate(() => (window as { __fakeEngine?: { networkChecks?: number } }).__fakeEngine?.networkChecks ?? 0);
  const before = await checks();
  await expect.poll(checks, { timeout: 45_000 }).toBeGreaterThan(before);
}
const disabled = (page: Page) => page.getByTestId('spend-disabled');
const sendButton = (page: Page) => page.locator('form').getByRole('button', { name: 'Send', exact: true });

async function review(page: Page, amount: string) {
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address').fill(UA);
  await page.getByLabel('Amount (ZEC)').fill(amount);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
}

test('an engine behind the network disables sending and shielding on every screen, and says why', async ({ page }) => {
  await fakeEngine(page, { networkOutdated: true, upcomingUpgrade: NU7 });
  await createWallet(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'outdated');

  // Balance: the banner, no way into Shield, and the Orchard notice.
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');
  await expect(banner(page)).toContainText('The Zcash network now runs on NU6.3 (Ironwood), which this version');
  // Spending is off already, so the next upgrade adds nothing.
  await expect(banner(page)).not.toContainText('NU7');
  // Scanned to the tip, but not "up to date", and the balance says what it misses.
  await expect(pill(page)).toHaveText('Scanned to block 3,100,000 · behind the network');
  await expect(pill(page)).toHaveClass(/pill-warn/);
  await expect(page.getByTestId('balance-outdated')).toHaveText(
    'Payments sent to you through NU6.3 (Ironwood) are not in this balance yet.',
  );
  await expect(page.getByText('You have a transparent balance')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shield funds' })).toHaveCount(0);
  await expect(page.getByText('Shielding is disabled until Celari is updated for the current Zcash network.')).toBeVisible();
  await expect(page.getByText('Your shielded balance is in the Orchard pool, which Zcash is retiring.')).toBeVisible();

  // Send: no form at all.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(disabled(page)).toHaveText('Sending is disabled until Celari is updated for the current Zcash network.');
  await expect(page.getByLabel('Recipient address')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shield funds' })).toHaveCount(0);
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');

  // Receive: the unified address stays, with the warning above it instead of the
  // promise that funds land in the shielded balance; the transparent address works as before.
  await page.getByRole('button', { name: 'Receive' }).click();
  const warn = page.getByTestId('receive-outdated');
  await expect(warn).toHaveText(/go to the new Ironwood pool.*They are not lost.*Do not ask the sender to pay again\./);
  await expect(page.getByTestId('receive-address')).toHaveText(/^u1/);
  const above = await warn.evaluate(
    (el, address) => !!(el.compareDocumentPosition(address!) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.getByTestId('receive-address').elementHandle(),
  );
  expect(above, 'the warning comes before the address').toBe(true);
  await expect(page.getByText('funds land directly in your shielded balance')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show transparent address' }).click();
  await expect(page.getByTestId('receive-address')).toHaveText(/^t1/);
  await expect(warn).toHaveCount(0);

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');

  // The lock screen says it too, before anything is unlocked.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet is locked' })).toBeVisible();
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');
  await expect(banner(page)).not.toContainText('NU7');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('balance-total')).toContainText('1.75');
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');
});

test('the network notices in Turkish', async ({ page }) => {
  await fakeEngine(page, { networkOutdated: true, upcomingUpgrade: NU7 });
  await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(banner(page)).toContainText('Celari Zcash ağının gerisinde kaldı');
  await expect(banner(page)).toContainText('Zcash ağı artık NU6.3 (Ironwood) kurallarıyla çalışıyor');
  await expect(banner(page)).not.toContainText('NU7');
  await expect(pill(page)).toHaveText('3.100.000. bloğa kadar tarandı · ağın gerisinde');
  await page.getByRole('button', { name: 'Gönder', exact: true }).click();
  await expect(disabled(page)).toHaveText('Celari güncel Zcash ağı için güncellenene kadar gönderme kapalı.');
  await page.getByRole('button', { name: 'Al', exact: true }).click();
  await expect(page.getByTestId('receive-outdated')).toContainText('yeni Ironwood havuzuna düşer');
  await page.getByRole('button', { name: 'Bakiye', exact: true }).click();
  await expect(page.getByText('Celari güncel Zcash ağı için güncellenene kadar gizliye aktarma kapalı.')).toBeVisible();
  await expect(page.getByText('Gizli bakiyen, Zcash’in kullanımdan kaldırdığı Orchard havuzunda.')).toBeVisible();
  await expect(page.getByTestId('balance-outdated')).toHaveText(
    'NU6.3 (Ironwood) üzerinden sana gönderilen ödemeler henüz bu bakiyede yok.',
  );
});

test('a server that does not answer the network check keeps spending off until it does', async ({ page }) => {
  await fakeEngine(page, { networkUnreachable: true });
  await createWallet(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'unverified');
  const unreachable = 'Celari could not check the network version. Sending and shielding stay disabled until it can.';
  await expect(banner(page)).toHaveText(unreachable);
  await expect(page.getByRole('button', { name: 'Shield funds' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  // Not "until Celari is updated": nothing says an update is needed.
  await expect(disabled(page)).toHaveText(unreachable);
  await expect(page.getByLabel('Recipient address')).toHaveCount(0);
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByTestId('receive-outdated')).toBeVisible();

  // Once the server answers (here on the boot after a lock), everything comes back.
  await fakeEngine(page, {});
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'supported');
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shield funds' })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Recipient address')).toBeVisible();
});

test('an announced upgrade the engine will not support is shown while spending still works', async ({ page }) => {
  await fakeEngine(page, { upcomingUpgrade: NU7 });
  await createWallet(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'supported');
  await expect(banner(page)).toHaveText(NU7_NOTICE);
  await expect(pill(page)).toHaveClass(/pill-ok/);
  await expect(page.getByTestId('balance-outdated')).toHaveCount(0);
  await expect(banner(page).locator('.notice')).toHaveClass(/notice-info/);
  await expect(page.getByRole('button', { name: 'Shield funds' })).toBeVisible();
  await review(page, '0.1');
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
});

test('the network notices for an announced upgrade, in Turkish', async ({ page }) => {
  await fakeEngine(page, { upcomingUpgrade: NU7 });
  await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(banner(page)).toHaveText(
    '3.543.405. blokta ağ NU7 kurallarına geçiyor; Celari’nin bu sürümü bunu desteklemiyor. O andan itibaren Celari güncellenene kadar gönderme ve gizliye aktarma kapanır.',
  );
});

test('a server behind the network keeps spending off and points to another server', async ({ page }) => {
  await fakeEngine(page, { networkServerBehind: true });
  await createWallet(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'serverBehind');
  await expect(banner(page)).toHaveText(SERVER_BEHIND);
  // The engine itself is not known to be behind.
  await expect(pill(page)).toContainText('Up to date');
  await expect(page.getByTestId('balance-outdated')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shield funds' })).toHaveCount(0);
  await expect(page.locator('.notice').getByText(SERVER_BEHIND)).toHaveCount(2);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(disabled(page)).toHaveText(SERVER_BEHIND);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(banner(page)).toHaveText(
    'Celari’nin kullandığı sunucu Zcash ağının gerisinde. Ayarlar’dan başka bir sunucu seç. O zamana kadar gönderme ve gizliye aktarma kapalı kalır.',
  );
});

test('a server lagging under the tip already seen cannot clear a spend', async ({ page }) => {
  await fakeEngine(page, {});
  await createWallet(page);
  await review(page, '0.1');
  // Another backend of the pool, 50 blocks behind, answers the spend's own check.
  await setKnobs(page, { networkLag: 50 });
  await sendButton(page).click();
  await expect(disabled(page)).toHaveText(SERVER_BEHIND);
  await expect(page.getByText('Nothing was sent.')).toBeVisible();
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'serverBehind');
});

test('once the engine is behind the network, a later "supported" answer does not turn spending back on', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await fakeEngine(page, { networkOutdated: true });
  await createWallet(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'outdated');
  // A lagging backend of the same pool answers the next check with rules the engine accepts.
  await setKnobs(page, { networkOutdated: false });
  await nextNetworkCheck(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'outdated');
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(disabled(page)).toBeVisible();
  await expect(page.getByLabel('Recipient address')).toHaveCount(0);
});

test('until the first network check answers, a spend waits', async ({ page }) => {
  await fakeEngine(page, { holdNetworkCheck: true });
  await createWallet(page);
  await expect(page.locator('.main')).toHaveAttribute('data-network', 'checking');
  await expect(banner(page)).toHaveCount(0);
  await review(page, '0.1');
  await expect(page.getByTestId('spend-wait')).toHaveText(/still connecting to the network/);
  await expect(sendButton(page)).toBeDisabled();
  await setKnobs(page, { holdNetworkCheck: false });
  await expect(page.getByTestId('spend-wait')).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();
});

test('a send is stopped before its broadcast if the network moved on meanwhile', async ({ page }) => {
  await fakeEngine(page, { holdStage: 'proving' });
  await createWallet(page);
  await review(page, '0.1');
  await sendButton(page).click();
  await expect(page.locator('.stages li.current')).toContainText('Generating zero-knowledge proofs');
  // The network upgrades while the proof is made; the spend asks again before broadcasting.
  await setKnobs(page, { networkOutdated: true, holdStage: undefined });
  await expect(disabled(page)).toHaveText('Sending is disabled until Celari is updated for the current Zcash network.');
  await expect(page.getByText('Nothing was sent.')).toBeVisible();
  await expect(page.getByText('may have reached the network')).toHaveCount(0);
  await expect(page.locator('.stages')).toHaveCount(0);
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByTestId('history').locator('.tx-sent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Balance' }).click();
  await expect(page.getByTestId('balance-shielded')).toContainText('1.25');
});

test('a shield is stopped before its broadcast if the network moved on meanwhile', async ({ page }) => {
  await fakeEngine(page, { holdStage: 'proving' });
  await createWallet(page);
  await page.getByRole('button', { name: 'Shield funds' }).click();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Shield', exact: true }).click();
  await expect(page.locator('.stages li.current')).toContainText('Generating zero-knowledge proofs');
  await setKnobs(page, { networkOutdated: true, holdStage: undefined });
  await expect(disabled(page)).toHaveText('Shielding is disabled until Celari is updated for the current Zcash network.');
  await expect(page.getByText('Nothing was sent.')).toBeVisible();
  await expect(page.getByText('will move to your shielded Orchard balance')).toHaveCount(0);
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByTestId('balance-transparent')).toContainText('0.50');
});

test('a spend is refused before anything is built once the network has moved on', async ({ page }) => {
  // A spend that got past the check would stop at building and show its stages.
  await fakeEngine(page, { holdStage: 'building' });
  await createWallet(page);
  await review(page, '0.1');
  // The wallet has not heard yet; the spend itself asks first.
  await setKnobs(page, { networkOutdated: true });
  await sendButton(page).click();
  await expect(disabled(page)).toHaveText('Sending is disabled until Celari is updated for the current Zcash network.');
  await expect(page.getByText('Nothing was sent.')).toBeVisible();
  await expect(page.locator('.stages')).toHaveCount(0);
});

test('the network is asked again on every sync pass', async ({ page }) => {
  // Held while broadcasting, after the spend's own last check.
  await fakeEngine(page, { holdStage: 'broadcasting' });
  await createWallet(page);
  await review(page, '0.1');
  await sendButton(page).click();
  await expect(page.locator('.stages li.current')).toContainText('Broadcasting');
  await setKnobs(page, { networkOutdated: true, holdStage: undefined });
  // The payment went out; the pass it starts brings the news.
  await expect(page.getByRole('heading', { name: '0.10 ZEC sent' })).toBeVisible({ timeout: 10_000 });
  await expect(banner(page)).toContainText('Celari is behind the Zcash network');
  await page.getByRole('button', { name: 'New payment' }).click();
  await expect(disabled(page)).toBeVisible();
});
