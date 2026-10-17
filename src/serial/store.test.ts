import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BAUD_RATE, useTransportStore } from '../transport/store';
import type { Transport } from '../transport/types';
import { BAUD_STORAGE_KEY, useSerialStore } from './store';

/** In-memory Transport: `emit` is the board printing, `written` is what the editor sent. */
class FakeTransport implements Transport {
  readonly kind = 'web-serial' as const;
  isOpen = true;
  baudRate: number | undefined = DEFAULT_BAUD_RATE;
  readonly written: Uint8Array[] = [];
  readonly opens: number[] = [];
  private readonly data = new Set<(chunk: Uint8Array) => void>();
  private readonly lost = new Set<() => void>();

  async open({ baudRate }: { baudRate: number }) {
    this.isOpen = true;
    this.baudRate = baudRate;
    this.opens.push(baudRate);
  }
  async close() {
    this.isOpen = false;
  }
  async write(data: Uint8Array) {
    if (!this.isOpen) throw new Error('not open');
    this.written.push(data);
  }
  onData(cb: (chunk: Uint8Array) => void) {
    this.data.add(cb);
    return () => this.data.delete(cb);
  }
  onDisconnect(cb: () => void) {
    this.lost.add(cb);
    return () => this.lost.delete(cb);
  }
  emit(text: string) {
    for (const cb of this.data) cb(new TextEncoder().encode(text));
  }
  unplug() {
    this.isOpen = false;
    for (const cb of this.lost) cb();
  }
  get listeners() {
    return this.data.size;
  }
}

const initialSerial = useSerialStore.getState();
const initialTransport = useTransportStore.getState();
const text = (bytes: Uint8Array[]) => bytes.map((b) => new TextDecoder().decode(b));

describe('serial store', () => {
  let transport: FakeTransport;

  beforeEach(() => {
    window.localStorage.clear();
    transport = new FakeTransport();
    useTransportStore.setState(
      { ...initialTransport, status: 'connected', transport, baudRate: DEFAULT_BAUD_RATE },
      true,
    );
    useSerialStore.setState({ ...initialSerial, baud: 115200 }, true);
    useSerialStore.getState().clear();
  });

  afterEach(() => {
    useSerialStore.getState().stop();
  });

  it('start → lines and plot series appear (batched per frame)', async () => {
    await useSerialStore.getState().start(transport);
    expect(useSerialStore.getState().status).toBe('listening');
    transport.emit('hola\r\ntemp:2');
    transport.emit('3.5\nesperando');
    // Nothing is published synchronously: React sees one update per animation frame.
    expect(useSerialStore.getState().lines).toEqual([]);
    await vi.waitFor(() => expect(useSerialStore.getState().lines).toEqual(['hola', 'temp:23.5']));
    const state = useSerialStore.getState();
    expect(state.partial).toBe('esperando');
    expect(state.totalLines).toBe(2);
    expect(state.series.series).toEqual([{ label: 'temp', slot: 0, values: [23.5] }]);
  });

  it('pause freezes what renders but keeps buffering; resume shows everything', async () => {
    await useSerialStore.getState().start(transport);
    useSerialStore.getState().setPaused(true);
    transport.emit('a:1\na:2\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useSerialStore.getState().lines).toEqual([]);
    expect(useSerialStore.getState().exportLog()).toBe('a:1\na:2\n');
    useSerialStore.getState().setPaused(false);
    expect(useSerialStore.getState().lines).toEqual(['a:1', 'a:2']);
    expect(useSerialStore.getState().series.series[0]?.values).toEqual([1, 2]);
  });

  it('send writes the text with the chosen line ending', async () => {
    await useSerialStore.getState().start(transport);
    await useSerialStore.getState().send('on', '\n');
    await useSerialStore.getState().send('off', '\r\n');
    await useSerialStore.getState().send('ñ', 'none');
    expect(text(transport.written)).toEqual(['on\n', 'off\r\n', 'ñ']);
    expect(useSerialStore.getState().error).toBeNull();
  });

  it('send without a connection reports it instead of throwing', async () => {
    await useSerialStore.getState().send('hola', '\n');
    expect(useSerialStore.getState().error).toEqual({ key: 'UI_SERIAL_ERROR_NOT_CONNECTED' });
  });

  it('a failed write shows the transport error verbatim', async () => {
    await useSerialStore.getState().start(transport);
    transport.isOpen = true;
    vi.spyOn(transport, 'write').mockRejectedValueOnce(new Error('write-failed: boom'));
    await useSerialStore.getState().send('x', 'none');
    expect(useSerialStore.getState().error).toEqual({
      key: 'UI_SERIAL_ERROR_SEND',
      detail: 'write-failed: boom',
    });
  });

  it('a baud change is persisted and reopens the port through the transport store', async () => {
    await useSerialStore.getState().start(transport);
    await useSerialStore.getState().setBaud(9600);
    expect(transport.opens).toEqual([9600]);
    expect(transport.isOpen).toBe(true);
    expect(useTransportStore.getState().baudRate).toBe(9600);
    expect(window.localStorage.getItem(BAUD_STORAGE_KEY)).toBe('9600');
    // Same baud again: no reopen (each reopen resets an UNO/NANO).
    await useSerialStore.getState().setBaud(9600);
    expect(transport.opens).toEqual([9600]);
  });

  it('quick baud changes end at the last one chosen', async () => {
    await useSerialStore.getState().start(transport);
    const first = useSerialStore.getState().setBaud(9600);
    const second = useSerialStore.getState().setBaud(115200);
    await Promise.all([first, second]);
    expect(useSerialStore.getState().baud).toBe(115200);
    expect(useTransportStore.getState().baudRate).toBe(115200);
    expect(transport.baudRate).toBe(115200);
  });

  it('a new connection does not glue onto the last unfinished line', async () => {
    await useSerialStore.getState().start(transport);
    transport.emit('temp:2');
    transport.unplug();
    const next = new FakeTransport();
    useTransportStore.setState({ transport: next, status: 'connected' });
    await useSerialStore.getState().start(next);
    next.emit('3\n');
    await vi.waitFor(() => expect(useSerialStore.getState().lines).toEqual(['temp:2', '3']));
    expect(useSerialStore.getState().series.series).toEqual([]);
  });

  it('ignores a baud that is not in the list', async () => {
    await useSerialStore.getState().setBaud(1234);
    expect(useSerialStore.getState().baud).toBe(115200);
  });

  it('start reopens at the saved baud when it differs from the connection', async () => {
    useSerialStore.setState({ baud: 57600 });
    await useSerialStore.getState().start(transport);
    expect(transport.opens).toEqual([57600]);
  });

  it('a disconnect shows the notice and keeps the buffer', async () => {
    await useSerialStore.getState().start(transport);
    transport.emit('última línea\n');
    await vi.waitFor(() => expect(useSerialStore.getState().lines).toEqual(['última línea']));
    transport.unplug();
    expect(useSerialStore.getState().status).toBe('disconnected');
    expect(useSerialStore.getState().lines).toEqual(['última línea']);
    expect(transport.listeners).toBe(0);
  });

  it('muted drops bootloader traffic during a flash', async () => {
    await useSerialStore.getState().start(transport);
    useSerialStore.getState().setMuted(true);
    transport.emit('\x00\xff garbage\n');
    useSerialStore.getState().setMuted(false);
    transport.emit('listo\n');
    await vi.waitFor(() => expect(useSerialStore.getState().lines).toEqual(['listo']));
  });

  it('clear empties lines and series; stop unsubscribes', async () => {
    await useSerialStore.getState().start(transport);
    transport.emit('a:1\n');
    await vi.waitFor(() => expect(useSerialStore.getState().totalLines).toBe(1));
    useSerialStore.getState().clear();
    expect(useSerialStore.getState()).toMatchObject({ lines: [], totalLines: 0, partial: '' });
    expect(useSerialStore.getState().series.series).toEqual([]);
    useSerialStore.getState().stop();
    expect(transport.listeners).toBe(0);
    expect(useSerialStore.getState().status).toBe('idle');
  });

  it('a burst from a chatty board (300 lines, ~10 kB) publishes once per frame', async () => {
    await useSerialStore.getState().start(transport);
    let publishes = 0;
    const off = useSerialStore.subscribe((s, p) => {
      if (s.lines !== p.lines) publishes += 1;
    });
    const line = 'sensor:123.45 otro:6789.01 ruido\n'; // 33 bytes
    for (let i = 0; i < 300; i += 1) transport.emit(line);
    await vi.waitFor(() => expect(useSerialStore.getState().totalLines).toBe(300));
    off();
    expect(publishes).toBeLessThanOrEqual(2);
  });
});
