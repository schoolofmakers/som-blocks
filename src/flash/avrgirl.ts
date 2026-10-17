import type { BoardDefinition } from '../boards/types';
import type { CompileResult } from '../compile/types';
import { stripAnsi } from '../compile/status';
import type { Transport } from '../transport/types';
import { getSerial, type SerialLike, type SerialPortLike } from '../transport/web-serial';
import avrgirlUrl from 'avrgirl-arduino/dist/avrgirl-arduino.global.min.js?url';
import { installNodeGlobals } from './node-globals';
import { DrainingPort } from './stk500-port';
import { errorText, FlashError, throwIfAborted, type Flasher, type FlashPhase } from './types';

// Arduino UNO / NANO (stk500v1) over Web Serial with avrgirl-arduino's browser build (MIT).
//
// Pattern: noopkat/avrgirl-arduino avrgirl-arduino-browser.js + lib/connection-browser.js +
// lib/browser-serialport.js: `new AvrgirlArduino({ board, debug })`, `flash(hexBytes, cb)`;
// the protocol opens the port at the board's baud, pulses DTR to reset into the bootloader
// and runs stk500 sync → signature → program → verify. Its browser serial shim opens the port
// with `navigator.serial.requestPort()`, i.e. the browser's chooser, which needs a fresh click
// and would ask the student to pick the board a second time. We lend it the port the student
// already picked on the connect screen instead (`lendPort`), wrapped in a `DrainingPort`
// (stk500-port.ts) that drains stale sync replies like avrdude does.
// duinoapp-client's uploader/avrgirl.js (GPL, read only) passes a `serialPort` option that
// avrgirl 5 ignores; we do not rely on it.
//
// CLASSIC SCRIPT, NEVER AN ES MODULE. avrgirl bundles `stk500` 2.x, whose verifySignature and
// verifyPage assign an undeclared variable (`match = Buffer.concat(...)`, stk500/lib/stk500.js).
// In a classic script that silently creates a global; in an ES module (always strict) it
// throws `ReferenceError: match is not defined` inside avrgirl's read loop, which only
// console.errors it, so the upload hangs after the third GET_SYNC. Vite rebundles any
// `import()`ed file into an ES module chunk, so we import only the file's URL (`?url`: copied
// untouched, hashed, precached by the PWA) and inject it as a <script>. Upstream fix: declare
// `var match` in stk500's verifySignature/verifyPage. avrgirl-strict.test.ts pins this down.

/** avrgirl has no cancel and no byte progress; this bounds a stuck stk500 exchange. */
export const AVRGIRL_TIMEOUT_MS = 60_000;
/** Bound for the real port's close after the upload (Chrome took ~0.5 s on a NANO). */
export const PORT_CLOSE_TIMEOUT_MS = 3_000;

/** True when `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the global bundle exposes as `window.AvrgirlArduino`. */
export interface AvrgirlOptions {
  board: string;
  debug?: boolean | ((...args: unknown[]) => void);
}
export interface AvrgirlInstance {
  flash(file: Uint8Array, callback: (error?: unknown) => void): void;
}
export type AvrgirlConstructor = new (options: AvrgirlOptions) => AvrgirlInstance;

type AvrgirlWindow = Window & { AvrgirlArduino?: AvrgirlConstructor };

let loading: Promise<AvrgirlConstructor> | null = null;

/**
 * Buffer/process globals first (the bundle's boards.js reads `Buffer` while it evaluates), then
 * the classic-script bundle, injected once. Never `import()`s the bundle: see above.
 */
export function loadAvrgirl(doc: Document = document): Promise<AvrgirlConstructor> {
  loading ??= (async () => {
    await installNodeGlobals();
    const win = (doc.defaultView ?? window) as AvrgirlWindow;
    if (!win.AvrgirlArduino) {
      await new Promise<void>((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = avrgirlUrl;
        script.async = true;
        script.dataset.avrgirl = '';
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () => {
          script.remove();
          reject(new FlashError('unsupported-board', `could not load ${avrgirlUrl}`));
        });
        doc.head.append(script);
      });
    }
    if (!win.AvrgirlArduino) {
      throw new FlashError('unsupported-board', `${avrgirlUrl} did not define AvrgirlArduino`);
    }
    return win.AvrgirlArduino;
  })();
  // A failed load (offline, blocked) may be retried by the next upload.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Test hook: forget the cached loader. */
export function resetAvrgirlLoader(): void {
  loading = null;
}

/**
 * Makes the next `serial.requestPort()` call (avrgirl's, when it opens the port) resolve to
 * `port` without showing the chooser. One shot: that call restores the original at once, so a
 * Connect clicked later during the upload gets the real chooser. The returned function
 * restores it too (idempotent), for a flash that never asked. Shadows the method on the
 * `navigator.serial` instance; the prototype is never touched.
 */
export function lendPort(serial: SerialLike, port: unknown): () => void {
  const own = Object.getOwnPropertyDescriptor(serial, 'requestPort');
  let lent = true;
  const restore = () => {
    if (!lent) return;
    lent = false;
    if (own) Object.defineProperty(serial, 'requestPort', own);
    else delete (serial as { requestPort?: unknown }).requestPort;
  };
  Object.defineProperty(serial, 'requestPort', {
    configurable: true,
    writable: true,
    value: () => {
      restore();
      return Promise.resolve(port);
    },
  });
  return restore;
}

const PORT_LOST = /device has been lost|NetworkError|Failed to open|could not open|not open/i;

/**
 * avrgirl reports errors as text only. Before programming starts, a missing answer means the
 * bootloader never synced (wrong board, old vs new NANO bootloader, or no bootloader at all);
 * after it, the same timeout means the write broke off.
 */
export function avrgirlError(error: unknown, phase: FlashPhase): FlashError {
  if (error instanceof FlashError) return error;
  const text = errorText(error);
  if (/signature/i.test(text)) return new FlashError('wrong-chip', text);
  if (/not a supported board/i.test(text)) return new FlashError('unsupported-board', text);
  if (PORT_LOST.test(text)) return new FlashError('transport', text);
  if (/does not match|verif/i.test(text)) return new FlashError('verify-failed', text);
  if (phase === 'connect') return new FlashError('sync-failed', text);
  return new FlashError('write-failed', text);
}

export const avrgirlFlasher: Flasher = {
  supportsCancel: false,

  async flash(result: CompileResult, board: BoardDefinition, transport: Transport, hooks) {
    if (result.kind !== 'avr') {
      throw new FlashError(
        'unsupported-board',
        `${board.id} needs an avr build, got ${result.kind}`,
      );
    }
    const profile = board.upload.avrgirlBoard;
    if (!profile) throw new FlashError('unsupported-board', `${board.id}: no avrgirlBoard profile`);
    const port = transport.nativePort;
    const serial = getSerial();
    if (transport.kind !== 'web-serial' || !port || !serial) throw new FlashError('no-port');
    throwIfAborted(hooks.signal);

    // avrgirl opens the raw port itself: our transport must release it first.
    await transport.close();
    const Avrgirl = await loadAvrgirl();
    throwIfAborted(hooks.signal);

    let phase: FlashPhase = 'connect';
    hooks.onProgress({ phase, percent: 0 });
    const debug = (...args: unknown[]) => {
      const line = stripAnsi(args.map((arg) => String(arg)).join(' ')).trim();
      if (line === '') return;
      hooks.onLog(line);
      if (/^flashing/i.test(line)) {
        phase = 'write';
        // No byte progress from stk500: the bar sits at half until avrgirl calls back.
        hooks.onProgress({ phase, percent: 50, message: 'avrgirl reports no byte progress' });
      }
    };

    // avrgirl gets the student's port behind the draining wrapper, through one lent
    // requestPort() call.
    const wrapped = new DrainingPort(port as SerialPortLike, (count) =>
      hooks.onLog(`drained ${count} stale byte(s) after sync`),
    );
    const restore = lendPort(serial, wrapped);
    const unhook = { current: () => {} };
    try {
      const avrgirl = new Avrgirl({ board: profile, debug });
      // The hex is Intel HEX *text*; avrgirl parses it itself (tools._parseHex).
      const { Buffer } = await import('buffer');
      const hex = Buffer.from(result.hex);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error?: FlashError) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        const timer = setTimeout(
          () => settle(new FlashError('transport', `no answer within ${AVRGIRL_TIMEOUT_MS} ms`)),
          AVRGIRL_TIMEOUT_MS,
        );
        // avrgirl's read loop catches whatever its data handlers throw and only
        // console.errors it, so the stk500 exchange just stops. Fail fast instead of waiting
        // for the timeout.
        unhook.current = watchConsoleErrors((error) => settle(avrgirlError(error, phase)));
        avrgirl.flash(hex, (error) => settle(error ? avrgirlError(error, phase) : undefined));
      });
      hooks.onProgress({ phase: 'done', percent: 100 });
    } catch (error) {
      throw avrgirlError(error, phase);
    } finally {
      unhook.current();
      restore();
      // avrgirl calls back right after *starting* its port close (Chrome took ~0.5 s to finish
      // it on a real NANO), or never closes after an error. The wrapper records that close
      // (or starts one) and we await it, bounded, before the caller reopens the port: a reopen
      // racing the close fails and ends the connection after a successful upload.
      if (!(await settlesWithin(wrapped.shutdown(), PORT_CLOSE_TIMEOUT_MS))) {
        hooks.onLog(`port close did not finish within ${PORT_CLOSE_TIMEOUT_MS} ms`);
      }
    }
  },
};

/** Where avrgirl's code runs from: the injected classic-script asset. */
const AVRGIRL_SOURCE = /avrgirl-arduino/;

/**
 * True for what avrgirl's read loop logs when a data handler throws: `console.error(e)` with
 * the Error as the only argument, thrown from avrgirl's own code (its stack points into the
 * avrgirl-arduino script). Errors other code on the page logs meanwhile (a lazy chunk that
 * failed to load, a component) do not match, so they never stop a working upload.
 */
export function isAvrgirlError(args: readonly unknown[]): boolean {
  if (args.length !== 1) return false;
  const [arg] = args;
  if (typeof arg === 'string') return /^Unexpected error:/.test(arg);
  if (typeof arg !== 'object' || arg === null || !('message' in arg)) return false;
  const stack = (arg as { stack?: unknown }).stack;
  return typeof stack === 'string' && AVRGIRL_SOURCE.test(stack);
}

/**
 * Calls `onError` for every avrgirl error (`isAvrgirlError`) passed to `console.error` until the
 * returned function is called (which restores the previous `console.error`, if nobody replaced
 * it meanwhile). Everything is still logged as before.
 */
export function watchConsoleErrors(onError: (error: unknown) => void): () => void {
  const previous = console.error;
  const hook = (...args: unknown[]) => {
    previous.apply(console, args);
    if (isAvrgirlError(args)) onError(args[0]);
  };
  console.error = hook;
  return () => {
    if (console.error === hook) console.error = previous;
  };
}
