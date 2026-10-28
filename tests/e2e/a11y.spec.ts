import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet, fillVerification, installContrast, type ContrastWindow } from './helpers';

type StageWindow = ContrastWindow & { stage: Promise<number> };

/** Seed words that wrap onto a second line or spill out of their cell. */
function brokenSeedWords(page: Page): Promise<string[]> {
  return page.getByTestId('seed-grid').evaluate((grid) => {
    const broken: string[] = [];
    const text = document.createRange();
    for (const word of grid.querySelectorAll<HTMLElement>('.seed-word')) {
      const original = word.textContent ?? '';
      // Monospace: any eight letters are as wide as the longest BIP39 word.
      word.textContent = 'wwwwwwww';
      // The span is a flex item (one box), so measure the text's own line boxes.
      text.selectNodeContents(word);
      const cell = word.parentElement!.getBoundingClientRect();
      if (text.getClientRects().length !== 1 || text.getBoundingClientRect().right > cell.right) broken.push(original);
      word.textContent = original;
    }
    return broken;
  });
}

const PHONE_WIDTHS = [320, 360, 412];

test('recovery phrase words never break across lines', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new wallet' }).click();
  await page.getByRole('button', { name: 'Reveal words' }).click();
  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    expect(await brokenSeedWords(page), `create, ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 412, height: 839 });

  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();
  await page.getByLabel('I wrote the words down in order').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await fillVerification(page, words);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password (again)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.locator('[data-testid="seed-grid"] .seed-word').first()).toHaveText(words[0]!);
  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    expect(await brokenSeedWords(page), `settings, ${width}px`).toEqual([]);
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('accent text, focus rings, field borders and the active tab have enough contrast', async ({ page }) => {
      await page.addInitScript(installContrast);
      await createWallet(page);
      const ratio = (selector: string, prop?: string, pseudo?: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((el, [p, ps]) => (window as unknown as ContrastWindow).contrastOf(el, p, ps), [prop, pseudo] as const);

      expect(await ratio('.topbar button.link'), 'Lock').toBeGreaterThanOrEqual(4.5);
      expect(await ratio('.tabbar button.active'), 'active tab label').toBeGreaterThanOrEqual(4.5);
      // The active tab is not marked by colour alone.
      const marker = page.locator('.tabbar button.active');
      expect(await marker.evaluate((el) => getComputedStyle(el, '::before').height)).toBe('3px');
      expect(await ratio('.tabbar button.active', 'background-color', '::before'), 'tab marker').toBeGreaterThanOrEqual(3);

      await page.getByRole('button', { name: 'Settings' }).click();
      expect(await ratio('input[name="server"]', 'border-top-color'), 'field border').toBeGreaterThanOrEqual(3);
      expect(await ratio('.settings-group a'), 'link').toBeGreaterThanOrEqual(4.5);

      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByLabel('Recipient address').fill(UA);
      await page.getByLabel('Amount (ZEC)').fill('0.1');
      await page.getByRole('button', { name: 'Review' }).click();
      expect(await ratio('input:focus', 'outline-color'), 'focus ring').toBeGreaterThanOrEqual(3);
      await page.locator('input:focus').fill(PASSWORD);
      // The current stage lasts well under a second with the fake engine, so
      // it is measured from inside the page the moment it appears.
      await page.evaluate(() => {
        const win = window as unknown as StageWindow;
        win.stage = new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            const current = document.querySelector('.stages li.current');
            if (!current) return;
            observer.disconnect();
            resolve(win.contrastOf(current));
          });
          observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        });
      });
      await page.locator('form').getByRole('button', { name: 'Send' }).click();
      const stage = await page.evaluate(() => (window as unknown as StageWindow).stage);
      expect(stage, 'current send stage').toBeGreaterThanOrEqual(4.5);
      await expect(page.locator('.stages')).toHaveCount(0, { timeout: 10_000 });

      // Shield opens from Balance, so Balance stays the current tab.
      await page.getByRole('button', { name: 'Balance' }).click();
      await page.getByRole('button', { name: 'Shield funds' }).click();
      await expect(page.getByRole('heading', { name: 'Shield funds' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Balance' })).toHaveAttribute('aria-current', 'page');
    });
  });
}

test('keyboard focus is never hidden under the top bar or the tab bar', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const bars = async () => {
    const [top, bottom] = await Promise.all([page.locator('.topbar').boundingBox(), page.locator('.tabbar').boundingBox()]);
    return { top: top!.y + top!.height, bottom: bottom!.y };
  };
  const expectBetweenBars = async (name: string) => {
    const focused = page.locator(':focus');
    await expect(focused).toHaveAccessibleName(name);
    const box = (await focused.boundingBox())!;
    const { top, bottom } = await bars();
    expect(box.y, `${name} vs top bar`).toBeGreaterThanOrEqual(top);
    expect(box.y + box.height, `${name} vs tab bar`).toBeLessThanOrEqual(bottom);
  };

  // Tab onto a control that is inside the viewport but under the tab bar. The
  // browser only scrolls it because scroll-padding-bottom keeps that strip out
  // of view (a control fully outside the viewport is centred either way).
  // A shorter viewport leaves room to scroll the control there.
  await page.setViewportSize({ width: 412, height: 640 });
  const target = page.getByRole('button', { name: 'Show viewing key' });
  await target.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - (innerHeight - 10)));
  const under = (await target.boundingBox())!;
  expect(under.y + under.height, 'Show viewing key starts under the tab bar').toBeGreaterThan((await bars()).bottom);
  expect(under.y + under.height, 'and inside the viewport').toBeLessThanOrEqual(640);
  await page.locator('select[name="auto-lock"]').evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
  await page.keyboard.press('Tab');
  await expectBetweenBars('Show viewing key');

  // Shift+Tab up to a field that sits under the top bar: it is scrolled clear.
  await page.locator('input[name="server"]').evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 10));
  await page.getByRole('button', { name: 'Reset to default' }).evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(':focus')).toHaveAttribute('name', 'server');
  const box = (await page.locator(':focus').boundingBox())!;
  expect(box.y, 'server field vs top bar').toBeGreaterThanOrEqual((await bars()).top);
});

test('the top bar keeps Lock on screen at 320px, in both languages', async ({ page }) => {
  await createWallet(page);
  // Where everything fits on one line, the sync pill sits next to Lock, not halfway to the brand.
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 640 });
    const pill = (await page.getByTestId('sync-status').boundingBox())!;
    const lock = (await page.getByRole('button', { name: 'Lock' }).boundingBox())!;
    expect(lock.y, `one line at ${width}px`).toBeLessThan(pill.y + pill.height);
    expect(lock.x - (pill.x + pill.width), `pill to Lock at ${width}px`).toBeLessThanOrEqual(12);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [language, lock, settings, home] of [
    ['English', 'Lock', 'Settings', 'Balance'],
    ['Türkçe', 'Kilitle', 'Ayarlar', 'Bakiye'],
  ] as const) {
    await page.locator('.tabbar button').last().click();
    await page.getByRole('button', { name: language }).click();
    for (const tab of [home, settings]) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${tab} width`).toBeLessThanOrEqual(320);
      const box = (await page.getByRole('button', { name: lock }).boundingBox())!;
      expect(box.x + box.width, `${lock} on ${tab}`).toBeLessThanOrEqual(320);
    }
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('on a wide screen the app is a framed card with both bars inside it', async ({ page }) => {
      await page.addInitScript(installContrast);
      await createWallet(page);
      const app = page.locator('.app');
      const frame = () =>
        app.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            radius: parseFloat(s.borderTopLeftRadius),
            border: parseFloat(s.borderTopWidth),
            shadow: s.boxShadow,
            card: s.backgroundColor,
            page: getComputedStyle(document.body).backgroundColor,
          };
        });
      // Phones keep the edge-to-edge column, the tab bar fixed across the screen.
      expect(await frame()).toMatchObject({ radius: 0, border: 0, shadow: 'none' });
      expect((await page.locator('.tabbar').boundingBox())!.width).toBe(412);

      await page.setViewportSize({ width: 1280, height: 800 });
      const style = await frame();
      expect(style.radius).toBeGreaterThan(0);
      expect(style.border).toBeGreaterThan(0);
      expect(style.shadow).not.toBe('none');
      expect(style.card, 'the card stands out from the page').not.toBe(style.page);
      const inside = async (where: string) => {
        // The frame can reach past the viewport; the bars stay inside both.
        const card = (await app.boundingBox())!;
        for (const bar of ['.topbar', '.tabbar']) {
          const box = (await page.locator(bar).boundingBox())!;
          expect(box.x, `${bar} left, ${where}`).toBeGreaterThanOrEqual(card.x);
          expect(box.x + box.width, `${bar} right, ${where}`).toBeLessThanOrEqual(card.x + card.width);
          expect(box.y, `${bar} top, ${where}`).toBeGreaterThanOrEqual(Math.max(0, card.y));
          expect(box.y + box.height, `${bar} bottom, ${where}`).toBeLessThanOrEqual(Math.min(800, card.y + card.height));
        }
      };
      await inside('Balance');
      // A short screen leaves no scrolling beyond the frame's margins.
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);

      // A long screen scrolls the page; both bars stay in view and in the frame.
      await page.getByRole('button', { name: 'Settings' }).click();
      for (const y of [400, 100_000]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await inside(`Settings scrolled to ${y}`);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(1280);
      const lock = await page
        .locator('.topbar button.link')
        .evaluate((el) => (window as unknown as ContrastWindow).contrastOf(el));
      expect(lock, 'Lock on the framed top bar').toBeGreaterThanOrEqual(4.5);
    });
  });
}

test('focus follows steps and errors instead of falling to the page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeFocused();
  await page.getByRole('button', { name: 'Reveal words' }).click();
  await expect(page.getByTestId('seed-grid')).toBeFocused();
  const words = await page.locator('[data-testid="seed-grid"] .seed-word').allTextContents();

  await page.getByLabel('I wrote the words down in order').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  // A step that focuses its own field keeps that focus.
  await expect(page.locator('input[name^="word-"]').first()).toBeFocused();
  // Back is the same button on both steps; the new step's heading takes focus.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeFocused();
  await page.getByRole('button', { name: 'Continue' }).click();
  await fillVerification(page, words);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Password errors are tied to their fields and announced politely.
  const password = page.getByLabel('Password', { exact: true });
  const repeat = page.getByLabel('Password (again)');
  await expect(password).toBeFocused();
  await password.fill('short');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAccessibleDescription('Must be at least 8 characters.');
  await expect(page.getByText('Must be at least 8 characters.')).toHaveAttribute('aria-live', 'polite');
  await password.fill(PASSWORD);
  await expect(password).not.toHaveAttribute('aria-invalid');
  await expect(password).toHaveAccessibleDescription('');
  // Typing the repeat correctly raises no error until a character differs.
  await repeat.fill(PASSWORD.slice(0, 5));
  await expect(repeat).not.toHaveAttribute('aria-invalid');
  await repeat.fill(`${PASSWORD.slice(0, 5)}x`);
  await expect(repeat).toHaveAttribute('aria-invalid', 'true');
  await expect(repeat).toHaveAccessibleDescription('Passwords do not match.');
  await repeat.fill(PASSWORD);
  await expect(repeat).not.toHaveAttribute('aria-invalid');
  // Once the repeat is left, a correct start is no longer excused: lengthening
  // the first password afterwards says why Create wallet is off.
  await password.fill(`${PASSWORD}-2`);
  await expect(repeat).toHaveAttribute('aria-invalid', 'true');
  await expect(repeat).toHaveAccessibleDescription('Passwords do not match.');
  await password.fill(PASSWORD);
  await expect(repeat).not.toHaveAttribute('aria-invalid');
  // So is a repeat left half-typed.
  await repeat.fill(PASSWORD.slice(0, 5));
  await expect(repeat).not.toHaveAttribute('aria-invalid');
  await repeat.blur();
  await expect(repeat).toHaveAttribute('aria-invalid', 'true');
  await expect(repeat).toHaveAccessibleDescription('Passwords do not match.');
  await repeat.fill(PASSWORD);
  await expect(repeat).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', { name: 'Create wallet' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Up to date', { timeout: 20_000 });

  // Tab switches keep focus on the tab and retitle the page.
  await expect(page).toHaveTitle('Balance · Celari');
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('button', { name: 'History' })).toBeFocused();
  await expect(page).toHaveTitle('History · Celari');

  // Switching language re-renders the heading but leaves focus on the switch.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Türkçe' })).toBeFocused();
  await expect(page).toHaveTitle('Ayarlar · Celari');
  await page.getByRole('button', { name: 'English' }).click();

  // A wrong password puts focus back in the field, marked invalid and described.
  await page.getByRole('button', { name: 'Lock' }).click();
  const field = page.getByLabel('Password');
  await field.fill('nope-nope-nope');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Wrong password.')).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription('Wrong password.');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('balance-total')).toBeVisible();
});

test('a secret revealed in Settings takes focus, and Close or Cancel gives it back', async ({ page }) => {
  await createWallet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  for (const [name, content] of [
    ['Show viewing key', /uview1/],
    ['Show recovery phrase', /Never share them/],
  ] as const) {
    const opener = page.getByRole('button', { name });
    await opener.click();
    await page.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(opener).toBeFocused();

    await opener.press('Enter');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.keyboard.press('Enter');
    // Not <body>: screen readers start at what was revealed.
    await expect(page.locator(':focus')).toContainText(content);
    await page.getByRole('button', { name: 'Close' }).press('Enter');
    await expect(opener).toBeFocused();
  }
});

test('language buttons are labelled in their own language', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Language' });
  await expect(group.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en');
  await expect(group.getByRole('button', { name: 'Türkçe' })).toHaveAttribute('lang', 'tr');
  await group.getByRole('button', { name: 'Türkçe' }).click();
  await expect(page.getByRole('group', { name: 'Dil' })).toBeVisible();
});
