/// <reference lib="dom" />
// ^ the init scripts below run in the page, where `window` exists.
import { expect, test } from '@playwright/test';

// No compile server runs in CI: point the editor at a port nothing listens on and check the
// student gets the explicit network message (not a generic failure, not a hang).
test('Compile against an unreachable server shows the network error', async ({ page }) => {
  const unreachable = 'http://127.0.0.1:59999';
  await page.addInitScript((url) => {
    window.localStorage.setItem('som.compileServerUrl', url);
  }, unreachable);

  await page.goto('/?lang=en');
  await expect(page.getByTestId('generated-code')).toContainText('void loop() {');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();

  await expect(page.getByTestId('compile-status')).toContainText(
    `Could not reach the compile server (${unreachable}). Check your internet.`,
  );
  await expect(page.getByRole('button', { name: 'Compile', exact: true })).toBeEnabled();
});

test('the server address can be changed from the settings popover', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.getByText('Server', { exact: true }).click();
  const input = page.getByLabel('Compile server address');
  await input.fill('https://compile.example.cl');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(input).toBeHidden();
  expect(await page.evaluate(() => window.localStorage.getItem('som.compileServerUrl'))).toBe(
    'https://compile.example.cl',
  );
});
