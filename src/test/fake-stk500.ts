import type { SerialSignals } from '../transport/types';
import type { SerialPortInfoLike, SerialPortLike } from '../transport/web-serial';

// A fake ATmega328P stk500v1 bootloader (optiboot / ATmegaBOOT) behind a Web Serial port, for
// avrgirl tests without hardware. It answers every command with the right frame, keeps the
// pages it is given so verify reads them back, and can answer the first GET_SYNC late, as the
// old-bootloader NANO did on real hardware (≈410 ms, past avrgirl's 400 ms timeout).
// e2e/upload-avr-fake-port.spec.ts carries an in-page copy of the same logic.

const INSYNC = 0x14;
const OK = 0x10;
const SIGNATURE_328P = [0x1e, 0x95, 0x0f];

export interface FakeStk500Options {
  /** Delay before the reply to the very first GET_SYNC after a reset. */
  firstSyncDelayMs?: number;
  /** Delay before every other reply. */
  replyDelayMs?: number;
  info?: SerialPortInfoLike;
}

/** Intel HEX text for `bytes` at address 0 (16-byte data records + EOF). */
export function intelHex(bytes: readonly number[]): string {
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

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export class FakeStk500Port extends EventTarget implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  /** Every command received, as hex (`30 20`, `75 20`, `64 00 80 46 …`). */
  readonly commands: string[] = [];
  /** Flash contents written with PROG_PAGE, by byte address. */
  readonly flash = new Map<number, number>();
  baudRate: number | undefined;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private address = 0;
  private syncsSinceReset = 0;
  private readonly options: Required<Omit<FakeStk500Options, 'info'>>;
  private readonly info: SerialPortInfoLike;

  constructor(options: FakeStk500Options = {}) {
    super();
    this.options = { firstSyncDelayMs: 0, replyDelayMs: 2, ...options };
    this.info = options.info ?? { usbVendorId: 0x1a86, usbProductId: 0x7523 };
  }

  getInfo(): SerialPortInfoLike {
    return this.info;
  }

  async open({ baudRate }: { baudRate: number }): Promise<void> {
    if (this.readable) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.baudRate = baudRate;
    this.syncsSinceReset = 0;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.command(Uint8Array.from(chunk)),
    });
  }

  async close(): Promise<void> {
    if (this.readable?.locked || this.writable?.locked) {
      throw new TypeError('Cannot close a port with locked streams.');
    }
    try {
      this.controller?.close();
    } catch {
      // Already closed.
    }
    this.readable = null;
    this.writable = null;
  }

  async setSignals(signals: SerialSignals): Promise<void> {
    // DTR going high again ends the reset pulse: the bootloader restarts.
    if (signals.dataTerminalReady) this.syncsSinceReset = 0;
  }

  /** The bytes of `length` flash bytes from `start` (0xff where nothing was written). */
  read(start: number, length: number): number[] {
    return Array.from({ length }, (_, i) => this.flash.get(start + i) ?? 0xff);
  }

  private command(cmd: Uint8Array): void {
    this.commands.push(hex(cmd));
    let reply: number[] = [INSYNC, OK];
    let delay = this.options.replyDelayMs;
    switch (cmd[0]) {
      case 0x30: // GET_SYNC
        if (this.syncsSinceReset === 0) delay = this.options.firstSyncDelayMs || delay;
        this.syncsSinceReset += 1;
        break;
      case 0x75: // READ_SIGN
        reply = [INSYNC, ...SIGNATURE_328P, OK];
        break;
      case 0x55: // LOAD_ADDRESS, word address little-endian
        this.address = ((cmd[1] ?? 0) | ((cmd[2] ?? 0) << 8)) * 2;
        break;
      case 0x64: {
        // PROG_PAGE: 64 len_hi len_lo 'F' data… 20
        const length = ((cmd[1] ?? 0) << 8) | (cmd[2] ?? 0);
        for (let i = 0; i < length; i++) this.flash.set(this.address + i, cmd[4 + i] ?? 0xff);
        break;
      }
      case 0x74: {
        // READ_PAGE: 74 len_hi len_lo 'F' 20
        const length = ((cmd[1] ?? 0) << 8) | (cmd[2] ?? 0);
        reply = [INSYNC, ...this.read(this.address, length), OK];
        break;
      }
      default:
        // SET_DEVICE (42), ENTER/LEAVE_PROGMODE (50/51) …: plain OK.
        break;
    }
    setTimeout(() => {
      try {
        this.controller?.enqueue(new Uint8Array(reply));
      } catch {
        // Port closed meanwhile.
      }
    }, delay);
  }
}
