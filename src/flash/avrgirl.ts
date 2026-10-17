import type { BoardDefinition } from '../boards/types';
import type { CompileResult } from '../compile/types';
import { stripAnsi } from '../compile/status';
import type { Transport } from '../transport/types';
import { getSerial, type SerialLike } from '../transport/web-serial';
import { installNodeGlobals } from './node-globals';
import { errorText, FlashError, throwIfAborted, type Flasher, type FlashPhase } from './types';

// Arduino UNO / NANO (stk500v1) over Web Serial with avrgirl-arduino's browser build (MIT).
//
// Pattern: noopkat/avrgirl-arduino avrgirl-arduino-browser.js + lib/connection-browser.js +
// lib/browser-serialport.js: `new AvrgirlArduino({ board, debug })`, `flash(hexBytes, cb)`;
// the protocol opens the port at the board's baud, pulses DTR to reset into the bootloader
// and runs stk500 sync → signature → program → verify. Its browser serial shim opens the port
// with `navigator.serial.requestPort()`, i.e. the browser's chooser, which needs a fresh click
// and would ask the student to pick the board a second time. We lend it the port the student
// already picked on the connect screen instead (`lendPort`), for the duration of the flash.
// duinoapp-client's uploader/avrgirl.js (GPL, read only) passes a `serialPort` option that
// avrgirl 5 ignores; we do not rely on it.

/** avrgirl has no cancel and no byte progress; this bounds a stuck stk500 exchange. */
export const AVRGIRL_TIMEOUT_MS = 60_000;

type AvrgirlModule = typeof import('avrgirl-arduino/dist/avrgirl-arduino.min.js');

/** Polyfills first, then the prebuilt UMD bundle (a lazy chunk, never in the main bundle). */
export async function loadAvrgirl(): Promise<AvrgirlModule['default']> {
  await installNodeGlobals();
  const mod = await import('avrgirl-arduino/dist/avrgirl-arduino.min.js');
  return mod.default;
}

/**
 * Makes `serial.requestPort()` resolve to `port` without showing the chooser, until the
 * returned function restores the original. Shadows the method on the `navigator.serial`
 * instance; the prototype is never touched.
 */
export function lendPort(serial: SerialLike, port: unknown): () => void {
  const own = Object.getOwnPropertyDescriptor(serial, 'requestPort');
  Object.defineProperty(serial, 'requestPort', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(port),
  });
  return () => {
    if (own) Object.defineProperty(serial, 'requestPort', own);
    else delete (serial as { requestPort?: unknown }).requestPort;
  };
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

    const restore = lendPort(serial, port);
    try {
      const avrgirl = new Avrgirl({ board: profile, debug });
      // The hex is Intel HEX *text*; avrgirl parses it itself (tools._parseHex).
      const { Buffer } = await import('buffer');
      const hex = Buffer.from(result.hex);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new FlashError('transport', `no answer within ${AVRGIRL_TIMEOUT_MS} ms`)),
          AVRGIRL_TIMEOUT_MS,
        );
        avrgirl.flash(hex, (error) => {
          clearTimeout(timer);
          if (error) reject(avrgirlError(error, phase));
          else resolve();
        });
      });
      hooks.onProgress({ phase: 'done', percent: 100 });
    } catch (error) {
      throw avrgirlError(error, phase);
    } finally {
      restore();
    }
  },
};
