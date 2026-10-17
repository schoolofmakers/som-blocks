import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('the code view shows the default project highlighted and downloads it as .ino', async ({
  page,
}) => {
  await page.goto('/?lang=es');
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  const code = page.getByTestId('generated-code');
  await expect(code).toBeVisible();
  await expect(code).toContainText('void setup() {');
  await expect(code).toContainText('void loop() {');
  // The highlighter chunk arrives after the plain text; colouring keeps the text intact.
  await expect(code).toHaveAttribute('data-highlighted', 'true');
  await expect(code.locator('span[class*="hljs-"]').first()).toBeVisible();
  const text = await code.textContent();
  expect(text).toContain('void loop() {');
  const lines = (text ?? '').replace(/\n$/, '').split('\n').length;
  await expect(page.getByTestId('code-line-numbers')).toHaveText(
    Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n'),
  );

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar .ino' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Mi_proyecto.ino');
  const path = await download.path();
  expect(await readFile(path, 'utf8')).toBe(text);
});

test('copy puts the sketch on the clipboard and says "Copiado"', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?lang=es');
  const code = page.getByTestId('generated-code');
  await expect(code).toContainText('void loop() {');
  await page.getByRole('button', { name: 'Copiar', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Copiado' })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(await code.textContent());
});

test('on a phone the code view starts collapsed and remembers being opened', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?lang=es');
  const code = page.getByTestId('generated-code');
  // Collapsed, but the text is still generated (other specs read it while hidden).
  await expect(code).toBeHidden();
  await expect(code).toContainText('void loop() {');

  await page.getByRole('button', { name: 'Ver código' }).click();
  await expect(code).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ocultar código' })).toBeVisible();
  await expect(page.getByTestId('generated-code')).toBeVisible();
});
