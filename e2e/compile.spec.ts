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

// The flake behind #32: opening a <details> queues its `toggle` event as a separate task,
// and Chrome may handle the following input events (typing, Save) first. Open, type and
// Save inside one task here so `toggle` always arrives after Save — deterministically.
test('Save closes the settings popover even when its toggle event arrives late', async ({
  page,
}) => {
  await page.goto('/?lang=en');
  const input = page.getByLabel('Compile server address');
  await expect(input).toBeAttached();
  const toggles = await page.evaluate(async () => {
    const microtasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));
    const field = document.querySelector<HTMLInputElement>('details input[type="url"]');
    const details = field?.closest('details');
    const summary = details?.querySelector('summary');
    const form = details?.querySelector('form');
    if (!field || !details || !summary || !form) throw new Error('settings popover not found');
    let toggleEvents = 0;
    details.addEventListener('toggle', () => toggleEvents++);

    summary.click();
    await microtasks(); // let React commit, but do not yield to the queued `toggle` task
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(field, 'https://late-toggle.example.cl');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await microtasks();
    form.requestSubmit();
    await microtasks();
    return toggleEvents;
  });
  expect(toggles).toBe(0); // the precondition: Save ran before any `toggle`
  await expect(input).toBeHidden();
  expect(await page.evaluate(() => window.localStorage.getItem('som.compileServerUrl'))).toBe(
    'https://late-toggle.example.cl',
  );
});

test('the settings popover stays inside a phone-width viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?lang=en');
  await page.getByText('Server', { exact: true }).click();
  const box = await page.locator('details[open] form').boundingBox();
  if (!box) throw new Error('settings form has no box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});
