import type { SerialSignals } from '../transport/types';
import type { SerialPortLike } from '../transport/web-serial';

// The port avrgirl gets for an stk500v1 upload: the student's real Web Serial port behind a
// thin wrapper that does what avrdude does after GET_SYNC and avrgirl does not — drain.
//
// Why: an old-bootloader NANO answers the first GET_SYNC late (≈410 ms, observed on real
// hardware), after avrgirl's 400 ms timeout. avrgirl then syncs again and takes the late reply
// for the next sync's answer, so one `14 10` reply is left over. It arrives while avrgirl
// waits for the 5-byte READ_SIGN answer and stk500 fails with "buffer overflow 7 > 5".
// avrdude's stk500_getsync() handles this by draining the input after a successful sync
// (stk500_drain); we do the same here: the first non-sync command after a GET_SYNC is held
// until the line has been quiet for `DRAIN_QUIET_MS`, and bytes arriving meanwhile (stale
// sync replies) are dropped. stk500v1 is strictly request/response, so nothing avrgirl waits
// for can arrive in that window.
//
// The wrapper also owns the real port's stream locks, so `shutdown()` can always give the
// port back, even when avrgirl never closes it (its close is not awaited, and a data-path
// error leaves its read loop running).

export const STK_GET_SYNC = 0x30;
export const DRAIN_QUIET_MS = 50;
/**
 * Upper bound for the hold. stk500's receive timer (board timeout, 400 ms on UNO/NANO) starts
 * when avrgirl hands us the command, so the hold must stay well below it.
 */
export const DRAIN_MAX_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DrainingPort {
  /** The student's port; avrgirl only ever sees this wrapper. */
  readonly real: SerialPortLike;
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  /** Bytes dropped by drains, for the log. */
  dropped = 0;

  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private lastByteAt = 0;
  private discarding = false;
  private afterSync = false;
  private closing: Promise<void> | null = null;
  private readonly onDrop: (count: number) => void;

  constructor(real: SerialPortLike, onDrop: (count: number) => void = () => {}) {
    this.real = real;
    this.onDrop = onDrop;
  }

  getInfo() {
    return this.real.getInfo();
  }

  setSignals(signals: SerialSignals): Promise<void> {
    return this.real.setSignals(signals);
  }

  async open(options: { baudRate: number }): Promise<void> {
    await this.real.open(options);
    if (!this.real.readable || !this.real.writable) throw new Error('port opened without streams');
    this.closing = null;
    this.reader = this.real.readable.getReader();
    this.writer = this.real.writable.getWriter();
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        void this.pump();
      },
    });
    this.writable = new WritableStream<Uint8Array>({ write: (chunk) => this.send(chunk) });
  }

  close(): Promise<void> {
    return this.shutdown();
  }

  /** Releases both locks and closes the real port. Idempotent; never throws. */
  shutdown(): Promise<void> {
    this.closing ??= (async () => {
      this.discarding = false;
      try {
        await this.reader?.cancel();
      } catch {
        // Already errored (unplugged).
      }
      try {
        this.reader?.releaseLock();
      } catch {
        // Released by cancel.
      }
      try {
        // A closed (not errored, not nulled) stream: avrgirl's read loop sees `done` and ends
        // instead of spinning on errors.
        this.controller?.close();
      } catch {
        // Already closed.
      }
      try {
        this.writer?.releaseLock();
      } catch {
        // Nothing to release.
      }
      this.reader = undefined;
      this.writer = undefined;
      try {
        await this.real.close();
      } catch {
        // Already closed or gone.
      }
    })();
    return this.closing;
  }

  private async pump(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        this.lastByteAt = performance.now();
        if (this.discarding) {
          this.dropped += value.length;
          this.onDrop(value.length);
          continue;
        }
        this.controller?.enqueue(value);
      }
    } catch {
      // Cancelled by shutdown(), or the device is gone: avrgirl's timeout reports it.
    }
    try {
      this.controller?.close();
    } catch {
      // Already closed.
    }
  }

  private async send(chunk: Uint8Array): Promise<void> {
    const isSync = chunk[0] === STK_GET_SYNC;
    if (!isSync && this.afterSync) await this.drain();
    this.afterSync = isSync;
    if (!this.writer) throw new Error('port closed');
    await this.writer.write(chunk);
  }

  private async drain(): Promise<void> {
    this.discarding = true;
    const started = performance.now();
    try {
      for (;;) {
        const now = performance.now();
        const quietFor = now - Math.max(this.lastByteAt, started);
        if (quietFor >= DRAIN_QUIET_MS || now - started >= DRAIN_MAX_MS) break;
        await sleep(Math.min(10, DRAIN_QUIET_MS - quietFor));
      }
    } finally {
      this.discarding = false;
    }
  }
}
