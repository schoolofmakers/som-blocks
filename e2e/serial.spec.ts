import { expect, test } from '@playwright/test';

// No hardware in CI: the panel, its tabs and the lazy xterm/uPlot chunks, with no port open.
test('serial panel opens, switches tabs and asks to connect first (es)', async ({ page }) => {
  await page.goto('/?lang=es');
  const panel = page.getByTestId('serial-panel');
  await expect(panel.getByRole('tabpanel')).toHaveCount(0);

  await panel.getByTestId('serial-panel-toggle').click();
  await expect(panel.getByRole('tab', { name: 'Monitor' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel.getByTestId('serial-notice')).toHaveText(
    'Conecta tu placa primero con el botón Conectar, arriba, para ver lo que escribe.',
  );
  // xterm mounted inside the host (lazy chunk loaded).
  await expect(panel.locator('[data-testid="serial-terminal"] .xterm')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  await expect(panel.getByLabel('Velocidad (baudios)')).toHaveValue('115200');

  await panel.getByRole('tab', { name: 'Gráfico' }).click();
  await expect(panel.getByTestId('plot-empty')).toContainText('graficar');

  // The tab is remembered across reloads.
  await page.reload();
  await page.getByTestId('serial-panel-toggle').click();
  await expect(page.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'true');
});

test('serial panel in English', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.getByRole('tab', { name: 'Plot' }).click();
  await expect(page.getByTestId('plot-empty')).toContainText('No numbers yet');
  await page.getByRole('tab', { name: 'Monitor' }).click();
  await expect(page.getByTestId('serial-notice')).toContainText('Connect your board first');
});
