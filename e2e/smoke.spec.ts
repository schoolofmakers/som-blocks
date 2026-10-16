import { expect, test } from '@playwright/test';

test('app loads and shows the title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeVisible();
  await expect(page).toHaveTitle('SoM Blocks');
});

test('?lang=en switches the shell to English', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(page.getByText('Program your board with blocks')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
