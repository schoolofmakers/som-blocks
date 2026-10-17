import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoOld } from '../boards/definitions/nano-old';
import { uno } from '../boards/definitions/uno';
import type { AvrCompileResult } from '../compile/types';
import { FakeSerialPort, fakeSerial, installSerial, type FakeSerial } from '../test/fake-serial';
import { fakeTransport } from '../test/fake-transport';
import type { SerialLike } from '../transport/web-serial';
import { avrgirlError, avrgirlFlasher, lendPort, waitForRelease } from './avrgirl';
import type { FlashProgress } from './types';

// avrgirl-arduino's browser bundle is mocked: the mock records what the flasher hands it and
// what `navigator.serial.requestPort()` returns while it runs (the lent port).
const h = vi.hoisted(() => ({
  options: [] as { board: string; debug?: unknown }[],
  files: [] as Uint8Array[],
  requested: [] as unknown[],
  order: [] as string[],
  outcome: null as unknown,
  debugLines: [] as string[],
}));

// Records when the polyfills are installed relative to the bundle import (the factory below
// runs when the bundle is first imported). The install itself is tested in node-globals.test.ts.
vi.mock('./node-globals', () => ({
  installNodeGlobals: vi.fn(async () => {
    h.order.push('globals');
  }),
}));

vi.mock('avrgirl-arduino/dist/avrgirl-arduino.min.js', () => {
  h.order.push('import');
  class AvrgirlArduino {
    readonly options: { board: string; debug?: (...args: unknown[]) => void };
    constructor(options: { board: string; debug?: (...args: unknown[]) => void }) {
      this.options = options;
      h.options.push(options);
    }
    flash(file: Uint8Array, callback: (error?: unknown) => void) {
      h.files.push(file);
      const serial = (navigator as Navigator & { serial: SerialLike }).serial;
      void serial.requestPort().then((port) => {
        h.requested.push(port);
        for (const line of h.debugLines) this.options.debug?.(line);
        callback(h.outcome);
      });
    }
  }
  return { default: AvrgirlArduino };
});

const HEX_TEXT = ':100000000C945C000C946E000C946E000C946E00CA\n:00000001FF\n';

function avrResult(): AvrCompileResult {
  return { kind: 'avr', hex: new TextEncoder().encode(HEX_TEXT), log: '' };
}

describe('avrgirlFlasher.flash', () => {
  let serial: FakeSerial;
  let uninstall: () => void;
  const chooserPort = new FakeSerialPort();

  beforeEach(() => {
    h.options.length = 0;
    h.files.length = 0;
    h.requested.length = 0;
    h.outcome = null;
    h.debugLines = ['connected', 'reset complete.', 'flashing, please wait...', 'flash complete.'];
    serial = fakeSerial(chooserPort);
    uninstall = installSerial(serial);
  });

  afterEach(() => {
    uninstall();
  });

  function run(board = nanoOld) {
    const transport = fakeTransport({ lent: board.id });
    const progress: FlashProgress[] = [];
    const log: string[] = [];
    const promise = avrgirlFlasher.flash(avrResult(), board, transport, {
      onProgress: (p) => progress.push(p),
      onLog: (line) => log.push(line),
    });
    return { promise, transport, progress, log };
  }

  it('closes the transport, lends avrgirl our port and passes the hex text bytes', async () => {
    const { promise, transport, progress, log } = run();
    await promise;
    expect(transport.events).toEqual(['close']);
    expect(h.options[0]!.board).toBe('nano');
    // The port the student picked on the connect screen; the chooser never opened.
    expect(h.requested).toEqual([transport.nativePort]);
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(h.files[0]!)).toBe(HEX_TEXT);
    expect(progress.map((p) => p.phase)).toEqual(['connect', 'write', 'done']);
    expect(log).toEqual(h.debugLines);
  });

  it('gives navigator.serial.requestPort back afterwards', async () => {
    await run().promise;
    await serial.requestPort();
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });

  it('uses the UNO profile for the UNO', async () => {
    await run(uno).promise;
    expect(h.options[0]!.board).toBe('uno');
  });

  it('installs Buffer/process before the bundle is imported', async () => {
    await run().promise;
    expect(h.order.slice(0, 2)).toEqual(['globals', 'import']);
  });

  it('no answer before programming is sync-failed (wrong board or bootloader)', async () => {
    h.debugLines = ['connected', 'reset complete.'];
    h.outcome = new Error('Sending 3020: receiveData timeout after 400ms');
    await expect(run().promise).rejects.toMatchObject({ code: 'sync-failed' });
    // Lending ends on failure too.
    await serial.requestPort();
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });

  it('the same timeout while programming is write-failed', async () => {
    h.debugLines = ['connected', 'flashing, please wait...'];
    h.outcome = new Error('Sending 6400: receiveData timeout after 400ms');
    await expect(run().promise).rejects.toMatchObject({ code: 'write-failed' });
  });

  it('an esp result is unsupported-board before the port is touched', async () => {
    const transport = fakeTransport();
    await expect(
      avrgirlFlasher.flash({ kind: 'esp', images: [], log: '' }, uno, transport, {
        onProgress: () => {},
        onLog: () => {},
      }),
    ).rejects.toMatchObject({ code: 'unsupported-board' });
    expect(transport.close).not.toHaveBeenCalled();
  });
});

describe('avrgirlError', () => {
  it('maps avrgirl/stk500 error text to flash error codes', () => {
    const code = (text: string, phase: 'connect' | 'write' = 'connect') =>
      avrgirlError(new Error(text), phase).code;
    expect(code('signature doesnt match. Found: 1e9514')).toBe('wrong-chip');
    expect(code('Invalid device signature; expecting: 1e950f received: 1e9801')).toBe('wrong-chip');
    expect(code('"nanox" is not a supported board type.')).toBe('unsupported-board');
    expect(code('Failed to open serial port.')).toBe('transport');
    expect(code('The device has been lost.', 'write')).toBe('transport');
    expect(code('Firmware on the device does not match local data', 'write')).toBe('verify-failed');
    expect(code('receiveData timeout after 400ms')).toBe('sync-failed');
    expect(code('receiveData timeout after 400ms', 'write')).toBe('write-failed');
  });
});

describe('waitForRelease', () => {
  it("waits until avrgirl's un-awaited close has let go of the port", async () => {
    const port = new FakeSerialPort();
    await port.open({ baudRate: 57600 });
    setTimeout(() => void port.close(), 30);
    await waitForRelease(port, 1_000, 5);
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
  });

  it('gives up after the timeout when the port stays held', async () => {
    const port = new FakeSerialPort();
    await port.open({ baudRate: 57600 });
    const started = Date.now();
    await waitForRelease(port, 40, 5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(port.readable).not.toBeNull();
  });
});

describe('lendPort', () => {
  it('shadows a prototype requestPort and removes the shadow afterwards', async () => {
    class Serial {
      requestPort() {
        return Promise.resolve('chooser');
      }
      getPorts() {
        return Promise.resolve([]);
      }
    }
    const serial = new Serial() as unknown as SerialLike;
    const restore = lendPort(serial, 'lent');
    expect(await serial.requestPort()).toBe('lent');
    restore();
    expect(Object.prototype.hasOwnProperty.call(serial, 'requestPort')).toBe(false);
    expect(await serial.requestPort()).toBe('chooser');
  });

  it('is one shot: a Connect during the upload gets the real chooser', async () => {
    const chooser = vi.fn(async () => 'chooser');
    const serial = { requestPort: chooser, getPorts: async () => [] } as unknown as SerialLike;
    const restore = lendPort(serial, 'lent');
    expect(await serial.requestPort()).toBe('lent'); // avrgirl opening the port
    expect(await serial.requestPort()).toBe('chooser'); // the student's Connect click
    expect(chooser).toHaveBeenCalledTimes(1);
    restore(); // idempotent
    expect(serial.requestPort).toBe(chooser);
  });
});
