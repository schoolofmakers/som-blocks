import { expect, test } from '@playwright/test';

// No hardware in CI and no way to drive the browser's port chooser: this checks that Upload
// sits next to Compile and explains why it is disabled. Real-board checks are manual
// (docs/testing/flash-hardware.md).
test('Upload is disabled with a reason until something is compiled (es)', async ({ page }) => {
  await page.goto('/?lang=es');
  const upload = page.getByTestId('upload-button');
  await expect(upload).toHaveText('Subir');
  await expect(upload).toBeDisabled();
  await expect(page.getByTestId('upload-reason')).toHaveText('Primero pulsa Compilar.');
  await expect(upload).toHaveAccessibleDescription('Primero pulsa Compilar.');
});

test('Upload reason in English', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(page.getByTestId('upload-button')).toHaveText('Upload');
  await expect(page.getByTestId('upload-button')).toBeDisabled();
  await expect(page.getByTestId('upload-reason')).toHaveText('Press Compile first.');
});
