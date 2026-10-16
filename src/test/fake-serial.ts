import { vi } from 'vitest';
import type { UsbFilter } from '../boards/types';
import type { SerialSignals } from '../transport/types';
import type { SerialLike, SerialPortInfoLike, SerialPortLike } from '../transport/web-serial';

// A fake Web Serial port with real streams, behaving like Chrome where it matters:
// close() rejects while a stream is locked, a line error replaces `readable`, an unplug
// errors the streams, nulls them and fires `disconnect`.
export class FakeSerialPort extends EventTarget implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly written: Uint8Array[] = [];
  readonly signals: SerialSignals[] = [];
  baudRate: number | undefined;
  closeCalls = 0;
  openError: Error | undefined;
  /** When set, each sink write waits for this before completing. */
  writeGate: Promise<void> | undefined;
  activeWrites = 0;
  maxConcurrentWrites = 0;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private rejectPendingWrite: ((error: Error) => void) | undefined;
  private readonly info: SerialPortInfoLike;

  constructor(info: SerialPortInfoLike = { usbVendorId: 0x1a86, usbProductId: 0x7523 }) {
    super();
    this.info = info;
  }

  getInfo(): SerialPortInfoLike {
    return this.info;
  }

  async open({ baudRate }: { baudRate: number }): Promise<void> {
    if (this.openError) throw this.openError;
    if (this.readable) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.baudRate = baudRate;
    this.readable = this.newReadable();
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) =>
        new Promise<void>((resolve, reject) => {
          this.activeWrites += 1;
          this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.activeWrites);
          this.rejectPendingWrite = reject;
          const finish = () => {
            this.activeWrites -= 1;
            this.written.push(chunk);
            resolve();
          };
          if (this.writeGate) void this.writeGate.then(finish);
          else finish();
        }),
    });
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.readable?.locked || this.writable?.locked) {
      throw new TypeError('Cannot close a port with locked streams.');
    }
    this.readable = null;
    this.writable = null;
  }

  async setSignals(signals: SerialSignals): Promise<void> {
    this.signals.push(signals);
  }

  /** Bytes arriving from the board. */
  push(bytes: number[]): void {
    this.controller?.enqueue(new Uint8Array(bytes));
  }

  /** A recoverable line error: the current stream errors, `readable` is replaced. */
  lineError(name: string): void {
    const old = this.controller;
    this.readable = this.newReadable();
    old?.error(new DOMException('line error', name));
  }

  /** The cable is pulled. `withEvent: false` simulates the stream dying before the event. */
  unplug({ withEvent = true } = {}): void {
    const lost = new DOMException('The device has been lost.', 'NetworkError');
    this.readable = null;
    this.controller?.error(lost);
    this.rejectPendingWrite?.(lost);
    if (withEvent) this.dispatchEvent(new Event('disconnect'));
  }

  private newReadable(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }
}

export interface FakeSerial extends SerialLike {
  requestPort: ReturnType<
    typeof vi.fn<(options?: { filters?: UsbFilter[] }) => Promise<SerialPortLike>>
  >;
  getPorts: ReturnType<typeof vi.fn<() => Promise<SerialPortLike[]>>>;
}

export function fakeSerial(port: SerialPortLike, remembered: SerialPortLike[] = []): FakeSerial {
  return {
    requestPort: vi.fn(async () => port),
    getPorts: vi.fn(async () => remembered),
  };
}

/** Installs `navigator.serial`; returns the uninstall function. */
export function installSerial(serial: SerialLike): () => void {
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
  return () => {
    delete (navigator as Navigator & { serial?: unknown }).serial;
  };
}

/** Lets pending promise chains (reader loop, write queue) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
