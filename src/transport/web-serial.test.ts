import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBoard } from '../boards/registry';
import { FakeSerialPort, fakeSerial, flush, installSerial } from '../test/fake-serial';
import { TransportError } from './types';
import {
  getSerial,
  isWebSerialSupported,
  rememberedPorts,
  requestPort,
  WebSerialTransport,
} from './web-serial';

async function openTransport(port = new FakeSerialPort()) {
  const transport = new WebSerialTransport(port);
  await transport.open({ baudRate: 115200 });
  return { port, transport };
}

describe('feature detection', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => uninstall?.());

  it('reports no Web Serial in jsdom (like Safari/Firefox) without throwing', async () => {
    expect(getSerial()).toBeUndefined();
    expect(isWebSerialSupported()).toBe(false);
    expect(await rememberedPorts()).toEqual([]);
    await expect(requestPort([])).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('finds navigator.serial and lists remembered ports', async () => {
    const port = new FakeSerialPort();
    uninstall = installSerial(fakeSerial(port, [port]));
    expect(isWebSerialSupported()).toBe(true);
    expect(await rememberedPorts()).toEqual([port]);
  });

  it('remembered ports fall back to none when getPorts fails', async () => {
    const serial = fakeSerial(new FakeSerialPort());
    serial.getPorts.mockRejectedValue(new DOMException('blocked', 'SecurityError'));
    expect(await rememberedPorts(serial)).toEqual([]);
  });
});

describe('requestPort', () => {
  it('calls the chooser synchronously with the board filters (user activation)', async () => {
    const port = new FakeSerialPort();
    const serial = fakeSerial(port);
    const pending = requestPort(getBoard('nano-old').usbFilters, serial);
    // Called before any await: still inside the click that triggered it.
    expect(serial.requestPort).toHaveBeenCalledWith({
      filters: [
        { usbVendorId: 0x1a86, usbProductId: 0x7523 },
        { usbVendorId: 0x0403, usbProductId: 0x6001 },
      ],
    });
    await expect(pending).resolves.toBe(port);
  });

  it('shows every port when given no filters', async () => {
    const serial = fakeSerial(new FakeSerialPort());
    await requestPort([], serial);
    expect(serial.requestPort).toHaveBeenCalledWith({});
  });

  it('maps a closed chooser to an explicit `cancelled` error', async () => {
    const serial = fakeSerial(new FakeSerialPort());
    serial.requestPort.mockRejectedValue(
      new DOMException('No port selected by the user.', 'NotFoundError'),
    );
    const error = await requestPort([], serial).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: 'cancelled' });
  });

  it('maps a SecurityError (no gesture, policy) to `blocked`', async () => {
    const serial = fakeSerial(new FakeSerialPort());
    serial.requestPort.mockRejectedValue(
      new DOMException('Must be handling a gesture', 'SecurityError'),
    );
    await expect(requestPort([], serial)).rejects.toMatchObject({
      code: 'blocked',
      detail: 'Must be handling a gesture',
    });
  });

  it('turns a synchronous throw into a rejection', async () => {
    const serial = fakeSerial(new FakeSerialPort());
    serial.requestPort.mockImplementation(() => {
      throw new TypeError('bad filter');
    });
    await expect(requestPort([], serial)).rejects.toMatchObject({ code: 'open-failed' });
  });
});

describe('WebSerialTransport', () => {
  it('opens, reads, writes and closes, releasing every lock', async () => {
    const { port, transport } = await openTransport();
    expect(transport.kind).toBe('web-serial');
    expect(transport.nativePort).toBe(port);
    expect(transport.isOpen).toBe(true);
    expect(port.baudRate).toBe(115200);

    const chunks: number[][] = [];
    const off = transport.onData((chunk) => chunks.push([...chunk]));
    port.push([0x68, 0x69]);
    await flush();
    expect(chunks).toEqual([[0x68, 0x69]]);

    await transport.write(new Uint8Array([1, 2, 3]));
    expect(port.written.map((chunk) => [...chunk])).toEqual([[1, 2, 3]]);
    expect(port.writable?.locked).toBe(false);

    off();
    port.push([0x00]);
    await flush();
    expect(chunks).toHaveLength(1);

    await transport.close();
    // The fake's close() throws while a stream is locked, like Chrome; it went through.
    expect(port.closeCalls).toBe(1);
    expect(port.readable).toBeNull();
    expect(transport.isOpen).toBe(false);
    await transport.close();
    expect(port.closeCalls).toBe(1);
  });

  it('queues writes so they never overlap', async () => {
    const { port, transport } = await openTransport();
    let release!: () => void;
    port.writeGate = new Promise((resolve) => (release = resolve));
    const first = transport.write(new Uint8Array([1]));
    const second = transport.write(new Uint8Array([2]));
    await flush();
    expect(port.activeWrites).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(port.maxConcurrentWrites).toBe(1);
    expect(port.written.map((chunk) => [...chunk])).toEqual([[1], [2]]);
  });

  it('keeps the write queue alive after a failed write', async () => {
    const { port, transport } = await openTransport();
    port.nextWriteError = new DOMException('transfer failed', 'NetworkError');
    const failed = transport.write(new Uint8Array([1]));
    const queued = transport.write(new Uint8Array([2]));
    await expect(failed).rejects.toMatchObject({ code: 'write-failed', detail: 'transfer failed' });
    await queued;
    await transport.write(new Uint8Array([3]));
    expect(port.written.map((chunk) => [...chunk])).toEqual([[2], [3]]);
    await transport.close();
  });

  it('reports an unplug once, closes cleanly and fails a pending write instead of hanging', async () => {
    const { port, transport } = await openTransport();
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);
    port.writeGate = new Promise(() => {}); // the board never acknowledges
    const pending = transport.write(new Uint8Array([1]));
    await flush();

    port.unplug();
    await expect(pending).rejects.toBeInstanceOf(TransportError);
    await flush();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(transport.isOpen).toBe(false);
    expect(port.closeCalls).toBe(1);
    await transport.close(); // after a disconnect: no-op, no throw
  });

  it('treats a reader that dies without a disconnect event as an unplug', async () => {
    const { port, transport } = await openTransport();
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);
    port.unplug({ withEvent: false });
    await flush();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(transport.isOpen).toBe(false);
  });

  it('keeps reading after a recoverable line error', async () => {
    const { port, transport } = await openTransport();
    const chunks: number[][] = [];
    transport.onData((chunk) => chunks.push([...chunk]));
    port.lineError('BreakError');
    await flush();
    port.push([7]);
    await flush();
    expect(chunks).toEqual([[7]]);
    expect(transport.isOpen).toBe(true);
    await transport.close();
  });

  it('a throwing data listener does not stop the reader for the others', async () => {
    const { port, transport } = await openTransport();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen = vi.fn();
    transport.onData(() => {
      throw new Error('listener bug');
    });
    transport.onData(seen);
    port.push([1]);
    port.push([2]);
    await flush();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
    await transport.close();
  });

  it('reports a port that will not open (held by another app) as open-failed', async () => {
    const port = new FakeSerialPort();
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    const transport = new WebSerialTransport(port);
    await expect(transport.open({ baudRate: 57600 })).rejects.toMatchObject({
      code: 'open-failed',
      detail: 'Failed to open serial port.',
    });
    expect(transport.isOpen).toBe(false);
    await transport.close();
  });

  it('forwards DTR/RTS and refuses signals when closed', async () => {
    const { port, transport } = await openTransport();
    await transport.setSignals({ dataTerminalReady: false, requestToSend: true });
    expect(port.signals).toEqual([{ dataTerminalReady: false, requestToSend: true }]);
    await transport.close();
    await expect(transport.setSignals({ dataTerminalReady: true })).rejects.toMatchObject({
      code: 'not-open',
    });
  });

  it('can be reopened after close (flashers reopen at their own baud)', async () => {
    const { port, transport } = await openTransport();
    await transport.close();
    await transport.open({ baudRate: 57600 });
    expect(port.baudRate).toBe(57600);
    expect(transport.isOpen).toBe(true);
    await transport.close();
  });
});
