import type { UsbFilter } from '../boards/types';
import { TransportError, type SerialSignals, type Transport } from './types';

// USB transport over Web Serial (desktop Chrome/Edge/Opera only).
//
// Pattern: espressif/esptool-js src/webserial.ts (Apache-2.0) — a reader loop that takes
// `port.readable.getReader()` per stream, releases the lock in `finally`, retries after the
// recoverable line errors (the port hands out a fresh `readable`), and `cancel()`s the reader
// before `port.close()`. noopkat/avrgirl-arduino lib/browser-serialport.js (MIT) for the DTR/RTS
// → `setSignals` mapping. Differences: we take the writer per write behind a queue instead of
// holding it (avrgirl) or racing it (esptool-js), so no write ever overlaps and the writable
// is unlocked between writes; and `close()` always releases both locks, even after an error
// or an unplug, so the port never stays stuck until a page reload.

/** The subset of the Web Serial `SerialPort` we use (lib.dom has no Web Serial types). */
export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortLike extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfoLike;
  setSignals(signals: SerialSignals): Promise<void>;
}

export interface SerialLike {
  requestPort(options?: { filters?: UsbFilter[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

/** `navigator.serial`, or undefined on Safari/Firefox/mobile. Never throws, also not at import. */
export function getSerial(): SerialLike | undefined {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return undefined;
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? undefined;
}

export function isWebSerialSupported(): boolean {
  return getSerial() !== undefined;
}

/** Ports this site was already granted: they reconnect without the browser's chooser. */
export async function rememberedPorts(serial = getSerial()): Promise<SerialPortLike[]> {
  if (!serial) return [];
  try {
    return await serial.getPorts();
  } catch {
    return [];
  }
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
}

// Duck-typed: a DOMException is not always `instanceof Error` (other realms, jsdom).
function errorDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function requestError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  // Chrome rejects with NotFoundError when the user closes the chooser without picking.
  if (errorName(error) === 'NotFoundError') return new TransportError('cancelled');
  // SecurityError: no user gesture, or blocked by permissions policy / site settings.
  if (errorName(error) === 'SecurityError') {
    return new TransportError('blocked', errorDetail(error));
  }
  return new TransportError('open-failed', errorDetail(error));
}

/**
 * Opens the browser's port chooser. Must run inside a click handler with nothing awaited
 * before it (the chooser needs the click's user activation), which is why this is not
 * `async`: `serial.requestPort` is called synchronously. An empty `filters` list shows every
 * port, for clones whose USB bridge is not in the board registry.
 */
export function requestPort(
  filters: readonly UsbFilter[],
  serial = getSerial(),
): Promise<SerialPortLike> {
  if (!serial) return Promise.reject(new TransportError('unsupported'));
  try {
    const options = filters.length > 0 ? { filters: filters.map((filter) => ({ ...filter })) } : {};
    return serial.requestPort(options).catch((error: unknown) => {
      throw requestError(error);
    });
  } catch (error) {
    return Promise.reject(requestError(error));
  }
}

// Line errors after which the port replaces `readable` and reading can go on (Web Serial spec).
const RECOVERABLE_READ_ERRORS = new Set([
  'BufferOverrunError',
  'BreakError',
  'FramingError',
  'ParityError',
]);

type State = 'closed' | 'open' | 'closing';

export class WebSerialTransport implements Transport {
  readonly kind = 'web-serial' as const;
  readonly nativePort: SerialPortLike;

  private state: State = 'closed';
  private closing: Promise<void> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private readLoopDone: Promise<void> = Promise.resolve();
  private writeChain: Promise<void> = Promise.resolve();
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private disconnectReported = false;

  constructor(port: SerialPortLike) {
    this.nativePort = port;
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  async open({ baudRate }: { baudRate: number }): Promise<void> {
    if (this.state !== 'closed') throw new TransportError('open-failed', 'already open');
    try {
      await this.nativePort.open({ baudRate });
    } catch (error) {
      // Typically "Failed to open serial port": another tab or the Arduino IDE holds it.
      throw new TransportError('open-failed', errorDetail(error));
    }
    this.state = 'open';
    this.closing = null;
    this.disconnectReported = false;
    this.nativePort.addEventListener('disconnect', this.handleDisconnectEvent);
    this.readLoopDone = this.readLoop();
  }

  close(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    this.closing ??= this.shutdown();
    return this.closing;
  }

  write(data: Uint8Array): Promise<void> {
    const run = this.writeChain.then(() => this.writeNow(data));
    // The chain must survive a failed write, or every later write would reject too.
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async setSignals(signals: SerialSignals): Promise<void> {
    if (this.state !== 'open') throw new TransportError('not-open');
    try {
      await this.nativePort.setSignals(signals);
    } catch (error) {
      throw new TransportError('write-failed', errorDetail(error));
    }
  }

  onData(cb: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  private readonly handleDisconnectEvent = (): void => {
    void this.deviceLost();
  };

  private async writeNow(data: Uint8Array): Promise<void> {
    const writable = this.nativePort.writable;
    if (this.state !== 'open' || !writable) throw new TransportError('not-open');
    const writer = writable.getWriter();
    this.writer = writer;
    try {
      await writer.write(data);
    } catch (error) {
      throw new TransportError(
        this.state === 'open' ? 'write-failed' : 'not-open',
        errorDetail(error),
      );
    } finally {
      this.writer = undefined;
      writer.releaseLock();
    }
  }

  private async readLoop(): Promise<void> {
    const port = this.nativePort;
    while (this.state === 'open' && port.readable) {
      const reader = port.readable.getReader();
      this.reader = reader;
      let recoverable = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) this.emitData(value);
        }
      } catch (error) {
        recoverable = RECOVERABLE_READ_ERRORS.has(errorName(error));
      } finally {
        this.reader = undefined;
        reader.releaseLock();
      }
      if (!recoverable) break;
    }
    // The stream ended or died without anyone calling close(): the device is gone.
    if (this.state === 'open') void this.deviceLost();
  }

  private emitData(chunk: Uint8Array): void {
    for (const cb of this.dataListeners) {
      try {
        cb(chunk);
      } catch (error) {
        // A broken listener must not stop the reader loop for everyone else.
        console.error('transport onData listener failed', error);
      }
    }
  }

  private async deviceLost(): Promise<void> {
    if (this.disconnectReported || this.state === 'closed') return;
    this.disconnectReported = true;
    await this.close();
    for (const cb of this.disconnectListeners) cb();
  }

  private async shutdown(): Promise<void> {
    this.state = 'closing';
    this.nativePort.removeEventListener('disconnect', this.handleDisconnectEvent);
    // Cancel the pending read so the loop exits and releases the reader lock in its finally.
    try {
      await this.reader?.cancel();
    } catch {
      // Stream already errored (unplugged); the loop still releases the lock.
    }
    await this.readLoopDone;
    // Abort the writable so a write still sitting in the stream is dropped, then let the
    // in-flight one settle (it rejects at once when the device is gone) so its `finally`
    // releases the writer lock. Writes queued behind it see `closing` and reject `not-open`.
    this.writer?.abort().catch(() => {
      // Already errored.
    });
    await this.writeChain;
    try {
      await this.nativePort.close();
    } catch {
      // The port can already be gone after an unplug; the locks are released either way.
    }
    this.state = 'closed';
  }
}
