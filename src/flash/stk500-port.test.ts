import { describe, expect, it } from 'vitest';
import { FakeSerialPort } from '../test/fake-serial';
import { DRAIN_QUIET_MS, DrainingPort } from './stk500-port';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>, until: number) {
  const bytes: number[] = [];
  while (bytes.length < until) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes.push(...(value ?? []));
  }
  return bytes;
}

describe('DrainingPort', () => {
  it('drops a stale sync reply that arrives before the next command (avrdude-style drain)', async () => {
    const real = new FakeSerialPort();
    const dropped: number[] = [];
    const port = new DrainingPort(real, (n) => dropped.push(n));
    await port.open({ baudRate: 57600 });
    const reader = port.readable!.getReader();
    const writer = port.writable!.getWriter();

    await writer.write(new Uint8Array([0x30, 0x20])); // GET_SYNC
    real.push([0x14, 0x10]); // its answer
    expect(await readAll(reader, 2)).toEqual([0x14, 0x10]);

    // READ_SIGN is held: a late answer to an earlier, timed-out GET_SYNC arrives meanwhile.
    const sent = writer.write(new Uint8Array([0x75, 0x20]));
    await sleep(10);
    real.push([0x14, 0x10]);
    await sent;
    expect(real.written.at(-1)).toEqual(new Uint8Array([0x75, 0x20]));
    real.push([0x14, 0x1e, 0x95, 0x0f, 0x10]);
    // avrgirl only sees the signature answer, not the stale `14 10`.
    expect(await readAll(reader, 5)).toEqual([0x14, 0x1e, 0x95, 0x0f, 0x10]);
    expect(dropped).toEqual([2]);

    reader.releaseLock();
    writer.releaseLock();
    await port.close();
    expect(real.readable).toBeNull();
  });

  it('holds the first command after a sync for a quiet line, and only that one', async () => {
    const real = new FakeSerialPort();
    const port = new DrainingPort(real);
    await port.open({ baudRate: 57600 });
    const writer = port.writable!.getWriter();
    await writer.write(new Uint8Array([0x30, 0x20]));
    let started = performance.now();
    await writer.write(new Uint8Array([0x75, 0x20]));
    expect(performance.now() - started).toBeGreaterThanOrEqual(DRAIN_QUIET_MS - 5);
    started = performance.now();
    await writer.write(new Uint8Array([0x42, 0x20]));
    expect(performance.now() - started).toBeLessThan(DRAIN_QUIET_MS);
    writer.releaseLock();
    await port.shutdown();
  });

  it('shutdown releases the real port even when avrgirl never closes it, and is idempotent', async () => {
    const real = new FakeSerialPort();
    const port = new DrainingPort(real);
    await port.open({ baudRate: 57600 });
    port.readable!.getReader(); // avrgirl's reader, never released
    await Promise.all([port.shutdown(), port.shutdown()]);
    expect(real.readable).toBeNull();
    expect(real.closeCalls).toBe(1);
  });
});
