import { expect, test } from '@playwright/test';

// English is the primary language: a browser set to Turkish still starts in English,
// and Turkish, once chosen, is remembered.
test.describe('in a browser set to Turkish', () => {
  test.use({ locale: 'tr-TR' });

  test('a fresh visit is in English, and choosing Türkçe is remembered', async ({ page }) => {
    // The page as served, before React runs, is English too.
    expect(await (await page.request.get('/')).text()).toContain('<html lang="en">');

    await page.goto('/');
    expect(await page.evaluate(() => navigator.language)).toBe('tr-TR');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Create a new wallet' })).toBeVisible();
    const group = page.getByRole('group', { name: 'Language' });
    await expect(group.getByRole('button').first(), 'English is listed first').toHaveText('English');
    await expect(group.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

    await group.getByRole('button', { name: 'Türkçe' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('button', { name: 'Yeni cüzdan oluştur' })).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('button', { name: 'Yeni cüzdan oluştur' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Dil' }).getByRole('button', { name: 'Türkçe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
