import { expect, test } from '@playwright/test';

// No hardware in CI: this checks the connect screen and the support matrix. Headless
// Chromium exposes `navigator.serial`, so USB must read as available.
test('Connect button opens the connect screen with the support matrix (es)', async ({ page }) => {
  await page.goto('/?lang=es');
  expect(await page.evaluate(() => 'serial' in navigator)).toBe(true);

  const button = page.getByTestId('connect-button');
  await expect(button).toHaveText('Conectar');
  await button.click();

  const screen = page.getByRole('dialog', { name: 'Conectar tu placa' });
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId('connect-board')).toHaveText('ESP32-C3 SuperMini');
  await expect(screen.getByTestId('support-usb')).toContainText('Disponible');
  await expect(screen.getByTestId('support-wifi')).toContainText('Disponible');
  await expect(screen.getByRole('button', { name: 'Conectar por USB' })).toBeEnabled();
  await expect(screen.getByTestId('support-reason')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(screen).toBeHidden();
});

test('connect screen in English follows the selected board', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.getByRole('combobox', { name: 'Board' }).selectOption('uno');
  await page.getByTestId('connect-button').click();
  const screen = page.getByRole('dialog', { name: 'Connect your board' });
  await expect(screen.getByTestId('connect-board')).toHaveText('Arduino UNO');
  await expect(screen.getByTestId('support-usb')).toContainText('Available');
  await expect(screen.getByTestId('support-wifi')).toContainText('Available');
});
