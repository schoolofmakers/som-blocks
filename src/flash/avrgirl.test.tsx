import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBoard } from '../boards/registry';
import { fullFqbn } from '../boards/types';
import { sketchRequest } from '../compile/client';
import { useCompileStore } from '../compile/store';
import { nanoOld } from '../boards/definitions/nano-old';
import { uno } from '../boards/definitions/uno';
import type { AvrCompileResult } from '../compile/types';
import { FakeSerialPort, fakeSerial, installSerial, type FakeSerial } from '../test/fake-serial';
import { fakeTransport } from '../test/fake-transport';
import { ConnectButton } from '../transport/ConnectScreen';
import { useTransportStore } from '../transport/store';
import type { SerialLike } from '../transport/web-serial';
import {
  avrgirlError,
  avrgirlFlasher,
  lendPort,
  loadAvrgirl,
  resetAvrgirlLoader,
  watchConsoleErrors,
  type AvrgirlConstructor,
} from './avrgirl';
import AVRGIRL_TS from './avrgirl.ts?raw';
import { DrainingPort } from './stk500-port';
import { useFlashStore } from './store';
import type { FlashProgress } from './types';

// avrgirl-arduino's classic-script bundle is replaced by a fake `window.AvrgirlArduino` that
// records what the flasher hands it and what `navigator.serial.requestPort()` returns while
// it runs (the lent port). The real bundle runs in avrgirl-strict.test.ts and in
// e2e/upload-avr-fake-port.spec.ts.
const h = vi.hoisted(() => ({
  options: [] as { board: string; debug?: unknown }[],
  files: [] as Uint8Array[],
  requested: [] as unknown[],
  order: [] as string[],
  outcome: null as unknown,
  debugLines: [] as string[],
  /** When set, the fake console.errors this and never calls back (avrgirl's read loop). */
  swallowed: null as unknown,
  /** When true, the fake opens and closes the lent port like browser-serialport does. */
  usesPort: false,
}));

// Records when the polyfills are installed relative to the script injection. The install
// itself is tested in node-globals.test.ts.
vi.mock('./node-globals', () => ({
  installNodeGlobals: vi.fn(async () => {
    h.order.push('globals');
  }),
}));

class FakeAvrgirl {
  readonly options: { board: string; debug?: (...args: unknown[]) => void };
  constructor(options: { board: string; debug?: (...args: unknown[]) => void }) {
    this.options = options;
    h.options.push(options);
  }
  flash(file: Uint8Array, callback: (error?: unknown) => void) {
    h.files.push(file);
    const serial = (navigator as Navigator & { serial: SerialLike }).serial;
    void serial.requestPort().then(async (port) => {
      h.requested.push(port);
      if (h.usesPort) {
        // Like avrgirl's browser-serialport: open, take both locks, and at the end release
        // them and start close() WITHOUT awaiting it before calling back.
        const lent = port as unknown as DrainingPort;
        await lent.open({ baudRate: 57600 });
        const reader = lent.readable!.getReader();
        const writer = lent.writable!.getWriter();
        for (const line of h.debugLines) this.options.debug?.(line);
        reader.releaseLock();
        writer.releaseLock();
        void lent.close();
        callback(h.outcome);
        return;
      }
      for (const line of h.debugLines) this.options.debug?.(line);
      if (h.swallowed) {
        console.error(h.swallowed);
        return;
      }
      callback(h.outcome);
    });
  }
}

type TestWindow = Window & { AvrgirlArduino?: AvrgirlConstructor };

const HEX_TEXT = ':100000000C945C000C946E000C946E000C946E00CA\n:00000001FF\n';

function avrResult(): AvrCompileResult {
  return { kind: 'avr', hex: new TextEncoder().encode(HEX_TEXT), log: '' };
}

describe('loadAvrgirl', () => {
  beforeEach(() => {
    resetAvrgirlLoader();
    delete (window as TestWindow).AvrgirlArduino;
    h.order.length = 0;
    document.head.querySelectorAll('script[data-avrgirl]').forEach((el) => el.remove());
  });

  it('injects the bundle as a classic <script> after installing Buffer/process', async () => {
    const append = vi.spyOn(document.head, 'append');
    append.mockImplementationOnce((...nodes) => {
      h.order.push('script');
      HTMLElement.prototype.append.call(document.head, ...nodes);
    });
    const loading = loadAvrgirl(document);
    await vi.waitFor(() => expect(document.querySelector('script[data-avrgirl]')).not.toBeNull());
    const script = document.querySelector<HTMLScriptElement>('script[data-avrgirl]')!;
    expect(script.type).toBe(''); // classic, not type="module"
    expect(script.getAttribute('src')).toMatch(/avrgirl-arduino\.global\.min\.js$/);
    expect(h.order).toEqual(['globals', 'script']);
    (window as TestWindow).AvrgirlArduino = FakeAvrgirl as unknown as AvrgirlConstructor;
    script.dispatchEvent(new Event('load'));
    await expect(loading).resolves.toBe(FakeAvrgirl);
    // Once: the next upload reuses it.
    await expect(loadAvrgirl(document)).resolves.toBe(FakeAvrgirl);
    expect(document.querySelectorAll('script[data-avrgirl]')).toHaveLength(1);
    append.mockRestore();
  });

  it('a script that fails to load rejects, and the next call tries again', async () => {
    const loading = loadAvrgirl(document);
    await vi.waitFor(() => expect(document.querySelector('script[data-avrgirl]')).not.toBeNull());
    document.querySelector('script[data-avrgirl]')!.dispatchEvent(new Event('error'));
    await expect(loading).rejects.toMatchObject({ code: 'unsupported-board' });
    void loadAvrgirl(document);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('script[data-avrgirl]')).toHaveLength(1),
    );
  });

  it('never imports the bundle as a module (ES modules are strict: see avrgirl-strict.test.ts)', () => {
    const source = AVRGIRL_TS;
    expect(source).not.toMatch(/import\(\s*['"]avrgirl-arduino/);
    expect(source).toMatch(/from 'avrgirl-arduino\/dist\/avrgirl-arduino\.global\.min\.js\?url'/);
  });
});

describe('avrgirlFlasher.flash', () => {
  let serial: FakeSerial;
  let uninstall: () => void;
  const chooserPort = new FakeSerialPort();

  beforeEach(() => {
    resetAvrgirlLoader();
    (window as TestWindow).AvrgirlArduino = FakeAvrgirl as unknown as AvrgirlConstructor;
    h.options.length = 0;
    h.files.length = 0;
    h.requested.length = 0;
    h.outcome = null;
    h.swallowed = null;
    h.debugLines = ['connected', 'reset complete.', 'flashing, please wait...', 'flash complete.'];
    serial = fakeSerial(chooserPort);
    uninstall = installSerial(serial);
  });

  afterEach(() => {
    uninstall();
    delete (window as TestWindow).AvrgirlArduino;
  });

  function run(board = nanoOld) {
    const transport = fakeTransport(new FakeSerialPort());
    const progress: FlashProgress[] = [];
    const log: string[] = [];
    const promise = avrgirlFlasher.flash(avrResult(), board, transport, {
      onProgress: (p) => progress.push(p),
      onLog: (line) => log.push(line),
    });
    return { promise, transport, progress, log };
  }

  it('closes the transport, lends avrgirl our port (drained) and passes the hex text bytes', async () => {
    const { promise, transport, progress, log } = run();
    await promise;
    expect(transport.events).toEqual(['close']);
    expect(h.options[0]!.board).toBe('nano');
    // The port the student picked on the connect screen, behind the draining wrapper; the
    // chooser never opened.
    expect(h.requested).toHaveLength(1);
    expect(h.requested[0]).toBeInstanceOf(DrainingPort);
    expect((h.requested[0] as DrainingPort).real).toBe(transport.nativePort);
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

  it("an error swallowed by avrgirl's read loop fails the flash at once, not after 60 s", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.debugLines = ['connected', 'reset complete.'];
    const swallowed = new ReferenceError('match is not defined');
    swallowed.stack = `ReferenceError: match is not defined
    at verifySignature (https://example.cl/assets/avrgirl-arduino.global.min-D55aAOpg.js:2:1)`;
    h.swallowed = swallowed;
    const started = performance.now();
    await expect(run().promise).rejects.toMatchObject({
      code: 'sync-failed',
      detail: 'match is not defined',
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    vi.mocked(console.error).mockRestore();
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

describe('upload end to end with a slow port close (real NANO: ~0.5 s)', () => {
  class SlowClosePort extends FakeSerialPort {
    closeResolvedAt = 0;
    openedAt: number[] = [];
    override async open(options: { baudRate: number }): Promise<void> {
      await super.open(options);
      this.openedAt.push(performance.now());
    }
    override async close(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await super.close();
      this.closeResolvedAt = performance.now();
    }
  }

  let uninstall: () => void = () => {};
  afterEach(async () => {
    await useTransportStore.getState().disconnect();
    uninstall();
    delete (window as TestWindow).AvrgirlArduino;
    h.usesPort = false;
  });

  it('reopens only after avrgirl’s un-awaited close resolved, and ends "Conectada"', async () => {
    resetAvrgirlLoader();
    (window as TestWindow).AvrgirlArduino = FakeAvrgirl as unknown as AvrgirlConstructor;
    h.usesPort = true;
    h.outcome = null;
    h.debugLines = ['connected', 'flashing, please wait...', 'flash complete.'];
    const port = new SlowClosePort();
    uninstall = installSerial(fakeSerial(port));
    await useTransportStore.getState().connect('nano-old', { port });
    expect(useTransportStore.getState().status).toBe('connected');

    const code = 'void setup() {}\nvoid loop() {}\n';
    useCompileStore.setState({
      status: 'ok',
      result: avrResult(),
      request: sketchRequest(code, fullFqbn(getBoard('nano-old'))),
    });
    await useFlashStore.getState().upload({ code, boardId: 'nano-old' });

    const state = useFlashStore.getState();
    expect(state.error).toBeNull();
    expect(state.status).toBe('done');
    expect(state.log).not.toContain('port did not reopen after the upload; connect again');
    // connect (115200), avrgirl (57600), and the reopen after the upload.
    expect(port.openedAt).toHaveLength(3);
    expect(port.openedAt[2]!).toBeGreaterThanOrEqual(port.closeResolvedAt);
    expect(useTransportStore.getState().status).toBe('connected');
    expect(port.baudRate).toBe(115200);
    render(<ConnectButton lang="es" />);
    expect(screen.getByTestId('connect-status')).toHaveTextContent('Conectada');
  }, 10_000);
});

describe('watchConsoleErrors', () => {
  const fromAvrgirl = (message: string) => {
    const error = new TypeError(message);
    error.stack = `TypeError: ${message}\n    at r (http://x/assets/avrgirl-arduino.global.min-abc.js:1:2)`;
    return error;
  };

  it('reports avrgirl errors and "Unexpected error:" lines, still logs, and unhooks', () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    const seen: unknown[] = [];
    const unhook = watchConsoleErrors((error) => seen.push(error));
    const boom = fromAvrgirl('boom');
    console.error(boom);
    console.error('Unexpected error: x');
    console.error('just text');
    unhook();
    console.error(fromAvrgirl('after'));
    expect(seen).toEqual([boom, 'Unexpected error: x']);
    expect(logged).toHaveLength(4);
    console.error = original;
  });

  it('ignores errors other code on the page logs during the upload', () => {
    const original = console.error;
    console.error = () => {};
    const seen: unknown[] = [];
    const unhook = watchConsoleErrors((error) => seen.push(error));
    // e.g. the serial panel's lazy chunk failing to load
    console.error('serial panel failed to load', fromAvrgirl('chunk'));
    console.error(new Error('a component somewhere'));
    unhook();
    expect(seen).toEqual([]);
    console.error = original;
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
