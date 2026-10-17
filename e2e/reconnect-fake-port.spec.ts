/// <reference lib="dom" />
// ^ the init script below runs in the page.
import { expect, test } from '@playwright/test';

// A native-USB ESP32-C3 re-enumerates on every reset (the RESET button, or the reset after an
// upload): Web Serial fires `disconnect` and a NEW SerialPort with the same ids shows up in
// getPorts() a moment later. The editor must find it again by itself, without the chooser,
// and the serial monitor must show what the board prints after the reset (Mr.Maker's
// acceptance criterion: the board stays connected). No hardware in CI.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    const ids = { usbVendorId: 0x303a, usbProductId: 0x1001 };
    let granted: EventTarget[] = [];

    function makePort(greeting: string) {
      let timer: ReturnType<typeof setInterval> | undefined;
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const port = Object.assign(new EventTarget(), {
        readable: null as ReadableStream<Uint8Array> | null,
        writable: null as WritableStream<Uint8Array> | null,
        getInfo: () => ids,
        setSignals: async () => {},
        async open() {
          port.readable = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
              timer = setInterval(() => c.enqueue(encoder.encode(`${greeting}\r\n`)), 100);
            },
            cancel() {
              clearInterval(timer);
            },
          });
          port.writable = new WritableStream<Uint8Array>();
        },
        async close() {
          clearInterval(timer);
          port.readable = null;
          port.writable = null;
        },
        /** The chip resets: the USB device leaves the bus. */
        vanish() {
          clearInterval(timer);
          controller?.error(new DOMException('The device has been lost.', 'NetworkError'));
          port.readable = null;
          port.writable = null;
          granted = granted.filter((p) => p !== port);
          port.dispatchEvent(new Event('disconnect'));
        },
      });
      return port;
    }

    const first = makePort('antes del reset');
    granted = [first];
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => first, getPorts: async () => granted },
    });
    Object.assign(window, {
      __pressReset: () => {
        first.vanish();
        // Back on the bus ~700 ms later, as a new port object with the same ids.
        setTimeout(() => {
          granted = [makePort('programa nuevo: hola')];
        }, 700);
      },
    });
  });
});

test('after a reset the C3 re-enumerates and the editor reconnects by itself', async ({ page }) => {
  await page.goto('/?lang=es');
  await page.getByTestId('connect-button').click();
  await page.getByRole('button', { name: 'Conectar por USB' }).click();
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada');
  await page.keyboard.press('Escape');
  await page.getByTestId('serial-panel-toggle').click();
  await expect(page.getByTestId('serial-terminal')).toContainText('antes del reset');

  await page.evaluate(() => (window as unknown as { __pressReset: () => void }).__pressReset());
  await expect(page.getByTestId('connect-status')).toHaveText('Reconectando…');
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada', { timeout: 6_000 });
  await expect(page.getByTestId('serial-terminal')).toContainText('programa nuevo: hola');
});
