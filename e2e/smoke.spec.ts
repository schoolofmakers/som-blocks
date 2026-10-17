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

test('Blockly workspace renders the full toolbox and generated code', async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on('request', (request) => {
    if (/blockly-media|static\.blockly\.com/.test(request.url())) mediaRequests.push(request.url());
  });

  await page.goto('/?lang=es&toolbox=full');
  // The main workspace, not the (hidden) flyout workspace.
  await expect(page.locator('svg.blocklySvg > g.blocklyWorkspace')).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Código' })).toBeVisible();
  await expect(page.getByTestId('generated-code')).toContainText('void setup() {');
  await expect(page.getByTestId('generated-code')).toContainText('void loop() {');

  // Blockly media (sprites, sounds) must come from our own bundle, never the Blockly CDN.
  await expect.poll(() => mediaRequests.length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  for (const url of mediaRequests) expect(url.startsWith(`${origin}/blockly-media/`)).toBe(true);
});

test('the starter toolbox shows the core categories, without lists or raw code', async ({
  page,
}) => {
  await page.goto('/?lang=es');
  for (const name of ['Lógica', 'Control', 'Matemáticas', 'Texto', 'Variables', 'Funciones']) {
    await expect(page.getByRole('treeitem', { name })).toBeVisible();
  }
  await expect(page.getByRole('treeitem', { name: 'Listas' })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: 'Código' })).toHaveCount(0);

  // Core block labels come from Blockly's Spanish messages; our map block from ours.
  await page.getByRole('treeitem', { name: 'Matemáticas' }).click();
  await expect(page.locator('.blocklyFlyout').getByText('convertir')).toBeVisible();

  // Dynamic categories are filled by Blockly itself.
  await page.getByRole('treeitem', { name: 'Funciones' }).click();
  await expect(page.locator('.blocklyFlyout .blocklyDraggable').first()).toBeVisible();
  await page.getByRole('treeitem', { name: 'Variables' }).click();
  await expect(page.locator('.blocklyFlyout').getByText('Crear variable')).toBeVisible();
});

test('dragging a raw block from the toolbox updates the generated code', async ({ page }) => {
  await page.goto('/?lang=en&toolbox=full');
  await page.getByRole('treeitem', { name: 'Code' }).click();
  // First flyout block is `include library [Wire.h]`.
  const flyoutBlock = page.locator('.blocklyFlyout .blocklyDraggable').first();
  await expect(flyoutBlock).toBeVisible();

  const workspace = page.locator('.blocklyMainBackground');
  const target = await workspace.boundingBox();
  const source = await flyoutBlock.boundingBox();
  if (!target || !source) throw new Error('workspace or flyout block has no box');
  await page.mouse.move(source.x + 10, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByTestId('generated-code')).toContainText('#include <Wire.h>');
  // The flyout closed after the drop; its scrollbar must hide with it (src/index.css fix
  // for Tailwind preflight's `svg { display: block }`).
  const flyoutScrollbar = page.locator('.blocklyToolboxFlyout + .blocklyFlyoutScrollbar');
  await expect(flyoutScrollbar).toHaveCount(1);
  await expect(flyoutScrollbar).toBeHidden();
});

test('board picker defaults to the C3, switches to UNO and persists across reload', async ({
  page,
}) => {
  await page.goto('/?lang=es');
  const picker = page.getByRole('combobox', { name: 'Placa' });
  await expect(picker).toHaveValue('esp32c3-supermini');
  await expect(page.getByTestId('board-chip')).toHaveText('ESP32-C3');

  await picker.selectOption('uno');
  await expect(page.getByTestId('board-chip')).toHaveText('AVR');
  // The empty workspace's sketch is board-independent; it must still render after a switch.
  await expect(page.getByTestId('generated-code')).toContainText('void loop() {');

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Placa' })).toHaveValue('uno');
  await expect(page.getByTestId('board-chip')).toHaveText('AVR');
});

test('hardware categories come before Código; the board LED block generates pinMode', async ({
  page,
}) => {
  // Código is full-toolbox only (docs/adr/0001-starter-toolbox.md).
  await page.goto('/?lang=es&toolbox=full');
  const categories = ['Entrada/Salida', 'Tiempo', 'Puerto Serie', 'Código'];
  for (const name of categories) {
    await expect(page.getByRole('treeitem', { name })).toBeVisible();
  }
  const labels = (await page.getByRole('treeitem').allTextContents()).map((t) => t.trim());
  const positions = categories.map((name) => labels.indexOf(name));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));

  await page.getByRole('treeitem', { name: 'Entrada/Salida' }).click();
  // First flyout block is `LED de la placa [encendido]`.
  const flyoutBlock = page.locator('.blocklyFlyout .blocklyDraggable').first();
  await expect(flyoutBlock).toBeVisible();
  const workspace = page.locator('.blocklyMainBackground');
  const target = await workspace.boundingBox();
  const source = await flyoutBlock.boundingBox();
  if (!target || !source) throw new Error('workspace or flyout block has no box');
  await page.mouse.move(source.x + 10, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  // Default board is the C3 SuperMini: LED on GPIO 8, active-low, never LED_BUILTIN.
  const code = page.getByTestId('generated-code');
  await expect(code).toContainText('pinMode(8, OUTPUT);');
  await expect(code).toContainText('digitalWrite(8, LOW);');
  await expect(code).not.toContainText('LED_BUILTIN');

  // Switching to the UNO regenerates with its LED: pin 13, active-high.
  await page.getByRole('combobox', { name: 'Placa' }).selectOption('uno');
  await expect(code).toContainText('pinMode(13, OUTPUT);');
  await expect(code).toContainText('digitalWrite(13, HIGH);');
});

test('Bluetooth is a full-toolbox category; its start block generates the BLE helpers', async ({
  page,
}) => {
  await page.goto('/?lang=es');
  await expect(page.getByRole('treeitem', { name: 'Puerto Serie' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Bluetooth' })).toHaveCount(0);

  await page.goto('/?lang=es&toolbox=full');
  await page.getByRole('treeitem', { name: 'Bluetooth' }).click();
  // First flyout block is `iniciar Bluetooth con el nombre [mi placa]`.
  const flyoutBlock = page.locator('.blocklyFlyout .blocklyDraggable').first();
  await expect(flyoutBlock).toBeVisible();
  const workspace = page.locator('.blocklyMainBackground');
  const target = await workspace.boundingBox();
  const source = await flyoutBlock.boundingBox();
  if (!target || !source) throw new Error('workspace or flyout block has no box');
  await page.mouse.move(source.x + 10, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  // Default board is the C3: BLE code, no #error.
  const code = page.getByTestId('generated-code');
  await expect(code).toContainText('#include <BLEDevice.h>');
  await expect(code).toContainText('somBleStart("mi placa");');
  await expect(code).not.toContainText('#error');

  // On the UNO the same block fails the compile with a translated message.
  await page.getByRole('combobox', { name: 'Placa' }).selectOption('uno');
  await expect(code).toContainText('#error "Bluetooth necesita una placa ESP32');
  await expect(code).not.toContainText('BLEDevice.h');
});

test('WiFi category: connect block on the C3, a translated #error on the UNO', async ({ page }) => {
  await page.goto('/?lang=es');
  await page.getByRole('treeitem', { name: 'WiFi' }).click();
  // First flyout block is `conectar a WiFi [mi-red] contraseña [contraseña]`.
  const flyoutBlock = page.locator('.blocklyFlyout .blocklyDraggable').first();
  await expect(flyoutBlock).toBeVisible();
  const workspace = page.locator('.blocklyMainBackground');
  const target = await workspace.boundingBox();
  const source = await flyoutBlock.boundingBox();
  if (!target || !source) throw new Error('workspace or flyout block has no box');
  await page.mouse.move(source.x + 10, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  const code = page.getByTestId('generated-code');
  await expect(code).toContainText('#include <WiFi.h>');
  await expect(code).toContainText('WiFi.mode(WIFI_STA);');
  await expect(code).toContainText('somWifiConnect("mi-red", "contraseña", 15000);');

  // The UNO has no WiFi: no WiFi code, and the compile fails with a message students can read.
  await page.getByRole('combobox', { name: 'Placa' }).selectOption('uno');
  await expect(code).toContainText('#error "Los bloques WiFi solo funcionan en una placa ESP32.');
  await expect(code).not.toContainText('#include <WiFi.h>');
});
