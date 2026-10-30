import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, UA, createWallet, fillVerification, installContrast, nav, navTab, type ContrastWindow } from './helpers';

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

  await nav(page, 'Settings');
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

      expect(await ratio('.topbar .lock-button'), 'Lock').toBeGreaterThanOrEqual(4.5);
      expect(await ratio('.tabbar button.active'), 'active tab label').toBeGreaterThanOrEqual(4.5);
      // The active tab is not marked by colour alone.
      const marker = page.locator('.tabbar button.active');
      expect(await marker.evaluate((el) => getComputedStyle(el, '::before').height)).toBe('3px');
      expect(await ratio('.tabbar button.active', 'background-color', '::before'), 'tab marker').toBeGreaterThanOrEqual(3);

      await nav(page, 'Settings');
      expect(await ratio('input[name="server"]', 'border-top-color'), 'field border').toBeGreaterThanOrEqual(3);
      expect(await ratio('.settings-group a'), 'link').toBeGreaterThanOrEqual(4.5);

      await nav(page, 'Send');
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
      await nav(page, 'Balance');
      await page.getByRole('button', { name: 'Shield funds' }).click();
      await expect(page.getByRole('heading', { name: 'Shield funds' })).toBeVisible();
      await expect(navTab(page, 'Balance')).toHaveAttribute('aria-current', 'page');
    });
  });
}

test('keyboard focus is never hidden under the top bar or the tab bar', async ({ page }) => {
  await createWallet(page);
  await nav(page, 'Settings');
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

test('on a wide screen the sidebar adds no scroll padding, and focus stays beside it', async ({ page }) => {
  await createWallet(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await nav(page, 'Settings');
  // The tab bar's measured height is the sidebar's here: it must not become padding.
  const padding = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return [s.scrollPaddingTop, s.scrollPaddingBottom];
  });
  expect(padding).toEqual(['12px', '12px']);

  // Tab onto a control well inside the viewport: nothing scrolls, it is not under the sidebar.
  const target = page.getByRole('button', { name: 'Show viewing key' });
  await target.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - (innerHeight - 80)));
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('select[name="auto-lock"]').evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveAccessibleName('Show viewing key');
  expect(await page.evaluate(() => window.scrollY), 'no scroll for a control in view').toBe(before);
  const box = (await focused.boundingBox())!;
  const side = (await page.locator('.side').boundingBox())!;
  expect(box.x, 'right of the sidebar').toBeGreaterThanOrEqual(side.x + side.width);
  expect(box.y + box.height).toBeLessThanOrEqual(800);

  // Tab onto one just below the viewport: it is scrolled fully into view.
  await target.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - (innerHeight + 4)));
  await page.locator('select[name="auto-lock"]').evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
  await page.keyboard.press('Tab');
  const shown = (await focused.boundingBox())!;
  expect(shown.y, 'below the top').toBeGreaterThanOrEqual(0);
  expect(shown.y + shown.height, 'above the bottom').toBeLessThanOrEqual(800);
});

test('the top bar keeps Lock on screen at 320px, in both languages', async ({ page }) => {
  await createWallet(page);
  // Where everything fits on one line, the sync pill sits next to Lock, not halfway to the brand.
  // DejaVu Sans, the wide fallback font on Linux CI runners, is the case that has to fit.
  await page.addStyleTag({ content: '.topbar, .topbar * { font-family: "DejaVu Sans", sans-serif !important; }' });
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 640 });
    const pill = (await page.getByTestId('sync-status').boundingBox())!;
    const lock = (await page.getByRole('button', { name: 'Lock' }).boundingBox())!;
    expect(lock.y, `one line at ${width}px`).toBeLessThan(pill.y + pill.height);
    expect(lock.x - (pill.x + pill.width), `pill to Lock at ${width}px`).toBeLessThanOrEqual(12);
    expect(lock.x - (pill.x + pill.width), `pill clear of Lock at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(lock.x + lock.width, `Lock on screen at ${width}px`).toBeLessThanOrEqual(width);
  }
  // Narrow, only the logo shows, but the name is still there for screen readers.
  await expect(page.locator('.topbar-brand')).toHaveText('Celari');
  // A pill cut short keeps its whole label, in its text and in its tooltip.
  await expect(page.getByTestId('sync-status')).toHaveText(/^Up to date · block [\d,]+$/);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('title', /^Up to date · block [\d,]+$/);
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

/** The elements whose own text (not an icon beside it) runs onto a second line, by their text. */
function wrappedTexts(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) => {
    const range = document.createRange();
    return els.flatMap((el) => {
      const tops = new Set<number>();
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const line of range.getClientRects()) tops.add(Math.round(line.top));
      }
      return tops.size > 1 ? [el.textContent ?? ''] : [];
    });
  });
}

test('on a laptop the dashboard keeps short values whole and its actions on one row, in both languages', async ({ page }) => {
  await createWallet(page);
  for (const language of ['English', 'Türkçe']) {
    // Settings is the navigation's last item and Balance its first, in either language.
    await page.locator('.tabbar button').last().click();
    await page.getByRole('button', { name: language }).click();
    await page.locator('.tabbar button').first().click();
    await expect(page.locator('.hero-actions button')).toHaveCount(3);
    for (const width of [1024, 1180, 1265, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      // "On", "15 min", "Açık": a key may wrap between its words, a value is never split.
      expect(await wrappedTexts(page, '.privacy-card .kv dd:not(.mono)'), `values at ${width}px, ${language}`).toEqual([]);
      expect(await wrappedTexts(page, '.hero-actions button'), `button labels at ${width}px, ${language}`).toEqual([]);
      const rows = await page
        .locator('.hero-actions button')
        .evaluateAll((buttons) => new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size);
      expect(rows, `Send, Receive and Shield funds in one row at ${width}px, ${language}`).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 412, height: 839 });
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('on a wide screen the navigation is a full-height sidebar that stays in view', async ({ page }) => {
      await page.addInitScript(installContrast);
      await createWallet(page);
      const box = async (selector: string) => (await page.locator(selector).boundingBox())!;

      // Phones: no frame, the tab bar fixed across the bottom of the screen.
      const app = await page.locator('.app').evaluate((el) => {
        const s = getComputedStyle(el);
        return { radius: parseFloat(s.borderTopLeftRadius), border: parseFloat(s.borderTopWidth), shadow: s.boxShadow };
      });
      expect(app).toMatchObject({ radius: 0, border: 0, shadow: 'none' });
      const bar = await box('.tabbar');
      expect(bar.width).toBe(412);
      expect(bar.y + bar.height).toBeCloseTo(839, 0);

      await page.setViewportSize({ width: 1280, height: 800 });
      const inView = async (where: string) => {
        const s = await box('.side');
        // Within a pixel: at the very end of the page scrolling stops on a fraction.
        expect(s.x, `sidebar left, ${where}`).toBe(0);
        expect(s.y, `sidebar top, ${where}`).toBeCloseTo(0, 0);
        expect(s.height, `sidebar fills the height, ${where}`).toBeCloseTo(800, 0);
        // Brand, Lock, the navigation and the sync status are all inside it, in that order.
        const navBox = await box('.tabbar');
        const lock = await box('.lock-button');
        const status = await box('[data-testid="sync-status"]');
        for (const [name, b] of [
          ['navigation', navBox],
          ['Lock', lock],
          ['sync status', status],
        ] as const) {
          expect(b.x, `${name} left, ${where}`).toBeGreaterThanOrEqual(s.x);
          expect(b.x + b.width, `${name} right, ${where}`).toBeLessThanOrEqual(s.x + s.width);
          expect(b.y, `${name} top, ${where}`).toBeGreaterThanOrEqual(0);
          expect(b.y + b.height, `${name} bottom, ${where}`).toBeLessThanOrEqual(800);
        }
        expect(lock.y + lock.height, `Lock above the navigation, ${where}`).toBeLessThanOrEqual(navBox.y);
        expect(status.y, `sync status below the navigation, ${where}`).toBeGreaterThanOrEqual(navBox.y + navBox.height);
        // The content column starts where the sidebar ends.
        expect((await box('main.content')).x, `content beside the sidebar, ${where}`).toBeGreaterThanOrEqual(s.x + s.width);
      };
      await inView('Balance');

      // A short screen does not scroll; History with one payment is short.
      await nav(page, 'History');
      await expect(page.getByTestId('history')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);

      // A long screen scrolls the page; the sidebar stays put.
      await nav(page, 'Settings');
      for (const y of [400, 100_000]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await inView(`Settings scrolled to ${y}`);
      }
      expect(await page.evaluate(() => window.scrollY), 'the page itself scrolled').toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(1280);

      // Lock and the current item read well on the sidebar; the current item has a 3px gold marker.
      const contrast = (selector: string, prop?: string, pseudo?: string) =>
        page
          .locator(selector)
          .evaluate((el, [p, ps]) => (window as unknown as ContrastWindow).contrastOf(el, p, ps), [prop, pseudo] as const);
      expect(await contrast('.lock-button'), 'Lock on the sidebar').toBeGreaterThanOrEqual(4.5);
      expect(await contrast('.tabbar button.active'), 'current item').toBeGreaterThanOrEqual(4.5);
      expect(await page.locator('.tabbar button.active').evaluate((el) => getComputedStyle(el, '::before').width)).toBe('3px');
      expect(await contrast('.tabbar button.active', 'background-color', '::before'), 'marker').toBeGreaterThanOrEqual(3);

      // However long the sync message gets, it grows its own card and never covers the navigation.
      await page.locator('[data-testid="sync-status"] .pill-head').evaluate((el) => {
        el.textContent = 'Scanned to block 3,533,800 and still waiting for the server to answer '.repeat(4);
      });
      const navBox = await box('.tabbar');
      const statusBox = await box('[data-testid="sync-status"]');
      expect(statusBox.y, 'long status below the navigation').toBeGreaterThanOrEqual(navBox.y + navBox.height);
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
  await nav(page, 'History');
  await expect(navTab(page, 'History')).toBeFocused();
  await expect(page).toHaveTitle('History · Celari');

  // Switching language re-renders the heading but leaves focus on the switch.
  await nav(page, 'Settings');
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
  await nav(page, 'Settings');
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
