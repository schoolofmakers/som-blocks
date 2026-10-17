import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { expect, test } from '@playwright/test';

// The serial panel end to end in a real browser, with a fake Web Serial port injected before
// the app loads (no hardware in CI). The "board" prints a greeting and `temp:`/`hum:` plotter
// lines every 50 ms, and records what the editor writes.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    const written: string[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    const port = Object.assign(new EventTarget(), {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      setSignals: async () => {},
      async open() {
        let n = 0;
        const opened = performance.now();
        port.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            // Like a board after the reset that opening the port causes: it starts
            // printing a moment later, not inside open().
            setTimeout(() => {
              controller.enqueue(encoder.encode('¡Hola desde la placa!\r\n'));
            }, 100);
            timer = setInterval(() => {
              if (n === 0 && performance.now() - opened < 150) return;
              n += 1;
              const temp = (20 + 3 * Math.sin(n / 8)).toFixed(2);
              const hum = (45 + 5 * Math.cos(n / 11)).toFixed(1);
              controller.enqueue(encoder.encode(`temp:${temp} hum:${hum}\r\n`));
            }, 50);
          },
          cancel() {
            clearInterval(timer);
          },
        });
        port.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            written.push(new TextDecoder().decode(chunk));
          },
        });
      },
      async close() {
        clearInterval(timer);
        port.readable = null;
        port.writable = null;
      },
    });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port, getPorts: async () => [] },
    });
    Object.assign(window, { __serialWritten: written });
  });
});

async function connect(page: import('@playwright/test').Page) {
  await page.getByTestId('connect-button').click();
  await page.getByRole('button', { name: 'Conectar por USB' }).click();
  await expect(page.getByTestId('connect-button')).toContainText('Conectada');
  await page.keyboard.press('Escape');
}

test('monitor shows what the board prints and sends a line', async ({ page }) => {
  await page.goto('/?lang=es');
  await connect(page);
  await page.getByTestId('serial-panel-toggle').click();
  const terminal = page.getByTestId('serial-terminal');
  // xterm renders only the visible rows: the greeting has scrolled up by now.
  await expect(terminal).toContainText(/temp:\d+\.\d\d hum:\d+\.\d/);
  // …but it is in the buffer, and so in the downloaded log.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar .txt' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^serial-\d{8}-\d{4}\.txt$/);
  const log = await readFile(await download.path(), 'utf8');
  expect(log.startsWith('¡Hola desde la placa!\ntemp:')).toBe(true);
  await expect(page.getByTestId('serial-notice')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Mensaje para la placa' }).fill('led on');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __serialWritten: string[] }).__serialWritten),
    )
    .toEqual(['led on\n']);

  if (process.env.SERIAL_SCREENSHOTS) {
    await page.screenshot({
      path: `${process.env.SERIAL_SCREENSHOTS}/monitor-light.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: `${process.env.SERIAL_SCREENSHOTS}/monitor-dark.png`,
      fullPage: true,
    });
  }
});

test('plot draws the temp and hum series', async ({ page }) => {
  await page.goto('/?lang=es');
  await connect(page);
  await page.getByRole('tab', { name: 'Gráfico' }).click();
  const plot = page.getByTestId('serial-plot');
  await expect(plot.locator('canvas')).toBeVisible();
  await expect(plot.locator('.u-legend')).toContainText('temp');
  await expect(plot.locator('.u-legend')).toContainText('hum');

  if (process.env.SERIAL_SCREENSHOTS) {
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${process.env.SERIAL_SCREENSHOTS}/plot-light.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${process.env.SERIAL_SCREENSHOTS}/plot-dark.png`,
      fullPage: true,
    });
  }
});
