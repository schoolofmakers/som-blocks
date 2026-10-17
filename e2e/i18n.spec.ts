import { expect, test } from '@playwright/test';

// A Spanish browser, so English after a reload can only come from the saved choice.
test.use({ locale: 'es-CL' });

test('the language switch changes the editor live and survives a reload', async ({ page }) => {
  await page.goto('/?lang=es');
  await expect(page.getByText('Programa tu placa con bloques')).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Lógica' })).toBeVisible();

  await page
    .getByRole('group', { name: 'Idioma' })
    .getByRole('button', { name: 'English' })
    .click();
  await expect(page.getByText('Program your board with blocks')).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Logic' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The choice replaces the ?lang= this page came with.
  expect(new URL(page.url()).searchParams.has('lang')).toBe(false);

  await page.reload();
  await expect(page.getByText('Program your board with blocks')).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'English' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('?lang= wins over the saved choice for that page load', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.setItem('som-blocks.lang', 'en'));

  await page.goto('/?lang=es');
  await expect(page.getByText('Programa tu placa con bloques')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.goto('/');
  await expect(page.getByText('Program your board with blocks')).toBeVisible();
});

test('the switch works from the keyboard', async ({ page }) => {
  await page.goto('/?lang=es');
  const english = page.getByRole('button', { name: 'English' });
  await english.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Program your board with blocks')).toBeVisible();
});
