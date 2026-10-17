/// <reference lib="dom" />
// ^ the init script below runs in the page.
import { expect, test } from '@playwright/test';

// Upload to an Arduino NANO (old bootloader) end to end in a real browser, through the REAL
// avrgirl bundle loaded as a classic script (src/flash/avrgirl.ts), against a fake stk500v1
// bootloader behind a fake Web Serial port (same logic as src/test/fake-stk500.ts). Like the
// real board it answers the first GET_SYNC late (410 ms, past avrgirl's 400 ms timeout), and
// like Chrome its close() takes a while (300 ms). The compile server is mocked with a small
// Intel HEX. No hardware in CI.

const SERVER = 'http://127.0.0.1:59998';
const PROGRAM = Array.from({ length: 160 }, (_, i) => (i * 7 + 3) & 0xff);

function intelHex(bytes: readonly number[]): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const data = bytes.slice(offset, offset + 16);
    const record = [data.length, (offset >> 8) & 0xff, offset & 0xff, 0x00, ...data];
    const checksum = (0x100 - (record.reduce((sum, b) => sum + b, 0) & 0xff)) & 0xff;
    lines.push(
      `:${[...record, checksum].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}`,
    );
  }
  lines.push(':00000001FF');
  return `${lines.join('\n')}\n`;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((server) => {
    window.localStorage.setItem('som.compileServerUrl', server);
    const commands: string[] = [];
    const flash = new Map<number, number>();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let address = 0;
    let syncsSinceReset = 0;
    let programmed = false;
    let printer: ReturnType<typeof setInterval> | undefined;
    const hex = (bytes: ArrayLike<number>) =>
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const port = Object.assign(new EventTarget(), {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      async setSignals(signals: { dataTerminalReady?: boolean }) {
        if (signals.dataTerminalReady) syncsSinceReset = 0;
      },
      async open({ baudRate }: { baudRate: number }) {
        if (port.readable) throw new DOMException('The port is already open.', 'InvalidStateError');
        syncsSinceReset = 0;
        port.readable = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            // Once programmed, the board runs the new sketch: it prints at 115200.
            if (programmed && baudRate === 115200) {
              printer = setInterval(() => {
                try {
                  c.enqueue(new TextEncoder().encode('programa: hola\r\n'));
                } catch {
                  // Closed.
                }
              }, 100);
            }
          },
        });
        port.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            const cmd = Uint8Array.from(chunk);
            commands.push(hex(cmd));
            let reply = [0x14, 0x10];
            let delay = 2;
            const length = ((cmd[1] ?? 0) << 8) | (cmd[2] ?? 0);
            if (cmd[0] === 0x30) {
              if (syncsSinceReset === 0) delay = 410;
              syncsSinceReset += 1;
            } else if (cmd[0] === 0x75) {
              reply = [0x14, 0x1e, 0x95, 0x0f, 0x10];
            } else if (cmd[0] === 0x55) {
              address = ((cmd[1] ?? 0) | ((cmd[2] ?? 0) << 8)) * 2;
            } else if (cmd[0] === 0x64) {
              for (let i = 0; i < length; i++) flash.set(address + i, cmd[4 + i] ?? 0xff);
            } else if (cmd[0] === 0x51) {
              programmed = true; // LEAVE_PROGMODE: the bootloader starts the sketch
            } else if (cmd[0] === 0x74) {
              const data = Array.from({ length }, (_, i) => flash.get(address + i) ?? 0xff);
              reply = [0x14, ...data, 0x10];
            }
            setTimeout(() => {
              try {
                controller?.enqueue(new Uint8Array(reply));
              } catch {
                // Closed meanwhile.
              }
            }, delay);
          },
        });
      },
      async close() {
        if (port.readable?.locked || port.writable?.locked) {
          throw new TypeError('Cannot close a port with locked streams.');
        }
        clearInterval(printer);
        // Chrome's close() took ~0.5 s on the real NANO.
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
          controller?.close();
        } catch {
          // Already closed.
        }
        port.readable = null;
        port.writable = null;
      },
    });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port, getPorts: async () => [] },
    });
    Object.assign(window, {
      __stk: { commands, read: (n: number) => Array.from({ length: n }, (_, i) => flash.get(i)) },
    });
  }, SERVER);

  await page.route(`${SERVER}/**`, async (route) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        hex: Buffer.from(intelHex(PROGRAM)).toString('base64'),
        log: 'Sketch uses 160 bytes.',
      }),
    });
  });
});

test('uploads to a NANO through the real avrgirl classic script, late first sync and all', async ({
  page,
}) => {
  await page.goto('/?lang=es');
  await page.getByRole('combobox', { name: 'Placa' }).selectOption('nano-old');
  await expect(page.getByTestId('generated-code')).toContainText('void loop() {');

  await page.getByTestId('connect-button').click();
  await page.getByRole('button', { name: 'Conectar por USB' }).click();
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Compilar', exact: true }).click();
  await expect(page.getByTestId('compile-status')).toContainText('Listo en');
  const upload = page.getByTestId('upload-button');
  await expect(upload).toBeEnabled();
  await upload.click();

  await expect(page.getByTestId('upload-status')).toHaveText(
    /¡Listo! Tu programa ya está en la placa\./,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('upload-error')).toHaveCount(0);
  // The port came back after avrgirl's slow close: still connected, no reopen error.
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada');
  await expect(page.getByTestId('compile-log')).toContainText('flash complete.');
  await expect(page.getByTestId('compile-log')).not.toContainText('did not reopen');
  // Acceptance (Mr.Maker): the board stays connected after the upload and the monitor
  // receives what the new program prints, at the monitor's baud.
  await page.getByTestId('serial-panel-toggle').click();
  await expect(page.getByTestId('serial-terminal')).toContainText('programa: hola');
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada');

  const stk = await page.evaluate(() => {
    const w = window as unknown as {
      __stk: { commands: string[]; read: (n: number) => (number | undefined)[] };
    };
    return { commands: w.__stk.commands, flash: w.__stk.read(160) };
  });
  const kinds = stk.commands.map((c) => c.slice(0, 2));
  expect(kinds).toContain('75'); // READ_SIGN reached (strict-mode bug: never got here)
  expect(kinds.filter((k) => k === '64')).toHaveLength(2); // two pages programmed
  expect(kinds.filter((k) => k === '74')).toHaveLength(2); // and verified
  expect(kinds.at(-1)).toBe('51'); // LEAVE_PROGMODE
  expect(stk.flash).toEqual(PROGRAM);
  // The avrgirl bundle was loaded as a classic script, not a module.
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLScriptElement>('script[data-avrgirl]')?.type ?? null,
    ),
  ).toBe('');
});
