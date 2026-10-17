import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeSerialPort,
  fakeSerial,
  flush,
  installSerial,
  type FakeSerial,
} from '../test/fake-serial';
import { FakeRelay, PAIRING, settle } from '../test/fake-relay';
import { DEFAULT_BAUD_RATE, reconnectTiming, useTransportStore } from './store';

const initial = useTransportStore.getState();
const defaultTiming = { ...reconnectTiming };

describe('transport store', () => {
  let port: FakeSerialPort;
  let serial: FakeSerial;
  let uninstall: () => void;

  beforeEach(() => {
    // Short reconnect window: these tests run the full search, just faster.
    Object.assign(reconnectTiming, { windowMs: 80, pollMs: 5 });
    useTransportStore.setState(initial, true);
    port = new FakeSerialPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    serial = fakeSerial(port);
    uninstall = installSerial(serial);
  });

  afterEach(async () => {
    await useTransportStore.getState().disconnect();
    uninstall();
    Object.assign(reconnectTiming, defaultTiming);
  });

  it('connects: connecting → connected with a friendly port label', async () => {
    const pending = useTransportStore.getState().connect('nano-old');
    expect(serial.requestPort).toHaveBeenCalledWith({
      filters: [
        { usbVendorId: 0x1a86, usbProductId: 0x7523 },
        { usbVendorId: 0x0403, usbProductId: 0x6001 },
      ],
    });
    expect(useTransportStore.getState().status).toBe('connecting');
    await pending;
    const state = useTransportStore.getState();
    expect(state.status).toBe('connected');
    expect(state.portLabel).toBe('Arduino NANO · 1a86:7523');
    expect(state.error).toBeNull();
    expect(state.transport?.isOpen).toBe(true);
    expect(port.baudRate).toBe(DEFAULT_BAUD_RATE);
  });

  it('a closed chooser goes back to disconnected with the cancelled hint', async () => {
    serial.requestPort.mockRejectedValue(new DOMException('No port selected', 'NotFoundError'));
    await useTransportStore.getState().connect('uno');
    const state = useTransportStore.getState();
    expect(state.status).toBe('disconnected');
    expect(state.error).toEqual({ key: 'UI_CONNECT_ERROR_CANCELLED', detail: undefined });
    expect(state.transport).toBeNull();
  });

  it('a port that will not open is an error with the browser detail', async () => {
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    await useTransportStore.getState().connect('uno');
    expect(useTransportStore.getState()).toMatchObject({
      status: 'error',
      error: { key: 'UI_CONNECT_ERROR_OPEN_FAILED', detail: 'Failed to open serial port.' },
      transport: null,
    });
  });

  it('without Web Serial the error says so', async () => {
    uninstall();
    await useTransportStore.getState().connect('uno');
    expect(useTransportStore.getState()).toMatchObject({
      status: 'error',
      error: { key: 'UI_CONNECT_ERROR_UNSUPPORTED' },
    });
    uninstall = installSerial(serial);
  });

  it('"show all ports" opens the chooser without filters', async () => {
    await useTransportStore.getState().connect('uno', { anyPort: true });
    expect(serial.requestPort).toHaveBeenCalledWith({});
    expect(useTransportStore.getState().status).toBe('connected');
  });

  it('a remembered port connects without the chooser', async () => {
    const remembered = new FakeSerialPort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    await useTransportStore.getState().connect('esp32c3-supermini', { port: remembered });
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(useTransportStore.getState().portLabel).toBe('ESP32-C3 SuperMini · 303a:1001');
  });

  it('an unplug looks for the board again, then gives up as disconnected', async () => {
    await useTransportStore.getState().connect('uno');
    port.unplug();
    await flush();
    expect(useTransportStore.getState()).toMatchObject({
      status: 'connecting',
      reconnecting: true,
      error: { key: 'UI_CONNECT_ERROR_DISCONNECTED' },
      transport: null,
      portLabel: null,
    });
    await vi.waitFor(() => expect(useTransportStore.getState().status).toBe('disconnected'));
    expect(useTransportStore.getState()).toMatchObject({
      reconnecting: false,
      error: { key: 'UI_CONNECT_ERROR_DISCONNECTED' },
      transport: null,
    });
    expect(serial.requestPort).toHaveBeenCalledTimes(1); // never the chooser again
  });

  it('a re-enumerated board (new port, same ids) is reopened without the chooser', async () => {
    const c3 = { usbVendorId: 0x303a, usbProductId: 0x1001 };
    const first = new FakeSerialPort(c3);
    await useTransportStore.getState().connect('esp32c3-supermini', { port: first });
    await useTransportStore.getState().reopen(9600);
    const other = new FakeSerialPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    const back = new FakeSerialPort(c3);
    // The reset: the old port disappears; a moment later a new one with the same ids appears.
    const ports: FakeSerialPort[] = [];
    serial.getPorts.mockImplementation(async () => ports);
    first.unplug();
    await flush();
    expect(useTransportStore.getState().reconnecting).toBe(true);
    ports.push(other, back);
    await vi.waitFor(() => expect(useTransportStore.getState().status).toBe('connected'));
    const state = useTransportStore.getState();
    expect(state.transport?.nativePort).toBe(back);
    expect(state).toMatchObject({ reconnecting: false, error: null, baudRate: 9600 });
    expect(state.portLabel).toBe('ESP32-C3 SuperMini · 303a:1001');
    expect(back.baudRate).toBe(9600);
    expect(other.baudRate).toBeUndefined();
    expect(serial.requestPort).not.toHaveBeenCalled();
  });

  it('disconnect() during the search stops it', async () => {
    await useTransportStore.getState().connect('uno');
    const back = new FakeSerialPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    port.unplug();
    await flush();
    await useTransportStore.getState().disconnect();
    serial.getPorts.mockResolvedValue([back]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useTransportStore.getState().status).toBe('disconnected');
    expect(back.baudRate).toBeUndefined();
  });

  it('disconnect closes the port and clears the state', async () => {
    await useTransportStore.getState().connect('uno');
    await useTransportStore.getState().disconnect();
    expect(useTransportStore.getState()).toMatchObject({
      status: 'disconnected',
      transport: null,
      portLabel: null,
      error: null,
    });
    expect(port.closeCalls).toBe(1);
    expect(port.readable).toBeNull();
  });

  it('a disconnect while connecting wins: the late port is closed again', async () => {
    let resolvePort!: (value: FakeSerialPort) => void;
    serial.requestPort.mockReturnValue(new Promise((resolve) => (resolvePort = resolve)));
    const pending = useTransportStore.getState().connect('uno');
    await useTransportStore.getState().disconnect();
    resolvePort(port);
    await pending;
    expect(useTransportStore.getState().status).toBe('disconnected');
    expect(port.closeCalls).toBe(1);
  });

  it('reconnecting to the same port right after disconnect waits for the close', async () => {
    await useTransportStore.getState().connect('uno');
    const closing = useTransportStore.getState().disconnect(); // not awaited, like a click
    await useTransportStore.getState().connect('uno', { port });
    await closing;
    expect(useTransportStore.getState().status).toBe('connected');
    expect(port.closeCalls).toBe(1);
  });

  it('reopen closes and reopens the same port at the new baud, keeping its listeners', async () => {
    await useTransportStore.getState().connect('uno');
    const transport = useTransportStore.getState().transport!;
    const chunks: number[][] = [];
    transport.onData((chunk) => chunks.push([...chunk]));
    await useTransportStore.getState().reopen(9600);
    expect(port.baudRate).toBe(9600);
    expect(port.closeCalls).toBe(1);
    expect(useTransportStore.getState()).toMatchObject({
      status: 'connected',
      transport,
      baudRate: 9600,
    });
    port.push([0x6f, 0x6b]);
    await flush();
    expect(chunks).toEqual([[0x6f, 0x6b]]);
  });

  it('a port that will not reopen ends the connection with the error', async () => {
    await useTransportStore.getState().connect('uno');
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    // reopen() looks for the board again before it gives up (getPorts lists the same port).
    serial.getPorts.mockResolvedValue([port]);
    await useTransportStore.getState().reopen(9600);
    expect(useTransportStore.getState()).toMatchObject({
      status: 'error',
      error: { key: 'UI_CONNECT_ERROR_OPEN_FAILED', detail: 'Failed to open serial port.' },
      transport: null,
    });
  });

  it('disconnect and reconnect during a reopen wait for it, then the same port opens', async () => {
    await useTransportStore.getState().connect('uno');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const open = port.open.bind(port);
    port.open = async (options) => {
      await gate;
      return open(options);
    };
    const reopening = useTransportStore.getState().reopen(9600);
    await flush();
    let disconnected = false;
    const disconnecting = useTransportStore
      .getState()
      .disconnect()
      .then(() => (disconnected = true));
    await flush();
    expect(disconnected).toBe(false); // still waiting for the reopen
    const reconnecting = useTransportStore.getState().connect('uno', { port });
    release();
    await Promise.all([reopening, disconnecting, reconnecting]);
    port.open = open;
    expect(useTransportStore.getState()).toMatchObject({ status: 'connected', error: null });
    expect(port.baudRate).toBe(DEFAULT_BAUD_RATE);
  });

  it('reopen without a connection does nothing', async () => {
    await useTransportStore.getState().reopen(9600);
    expect(useTransportStore.getState().status).toBe('disconnected');
  });

  it('ignores a second connect while one is in flight', async () => {
    const first = useTransportStore.getState().connect('uno');
    await useTransportStore.getState().connect('uno');
    await first;
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });
});

describe('transport store over WiFi (relay)', () => {
  let relay: FakeRelay;
  let restoreFetch: () => void;
  let uninstall: () => void;

  beforeEach(() => {
    useTransportStore.setState(initial, true);
    relay = new FakeRelay();
    restoreFetch = relay.install();
    uninstall = installSerial(fakeSerial(new FakeSerialPort({ usbVendorId: 0x303a })));
  });

  afterEach(async () => {
    await useTransportStore.getState().disconnect();
    restoreFetch();
    uninstall();
  });

  it('connects through the relay with the board name and presence', async () => {
    await useTransportStore.getState().connectRelay(PAIRING);
    const state = useTransportStore.getState();
    expect(state.status).toBe('connected');
    expect(state.transport?.kind).toBe('relay');
    expect(state.portLabel).toBe('placa-azul');
    expect(state.presence).toBe('online');
    await settle();
    relay.stream.push('offline', { lastSeen: 1 });
    await settle();
    expect(useTransportStore.getState().presence).toBe('offline');
  });

  it('closes an open USB connection first: only one board is ever the upload target', async () => {
    await useTransportStore.getState().connect('esp32c3-supermini');
    const usb = useTransportStore.getState().transport!;
    expect(usb.kind).toBe('web-serial');
    await useTransportStore.getState().connectRelay(PAIRING);
    expect(usb.isOpen).toBe(false);
    expect(useTransportStore.getState().transport?.kind).toBe('relay');
    // And back: USB replaces WiFi the same way.
    const wifi = useTransportStore.getState().transport!;
    await useTransportStore.getState().connect('esp32c3-supermini');
    expect(wifi.isOpen).toBe(false);
    expect(useTransportStore.getState().transport?.kind).toBe('web-serial');
    expect(useTransportStore.getState().presence).toBeNull();
  });

  it('a refused token is an error asking to pair again', async () => {
    await useTransportStore.getState().connectRelay({ ...PAIRING, token: 'cd'.repeat(32) });
    expect(useTransportStore.getState()).toMatchObject({
      status: 'error',
      transport: null,
      error: { key: 'UI_WIFI_ERROR_UNAUTHORIZED' },
    });
  });

  it('a baud change does not reopen the relay stream; a closed one reopens', async () => {
    await useTransportStore.getState().connectRelay(PAIRING);
    await settle();
    await useTransportStore.getState().reopen(9600);
    expect(relay.streams).toHaveLength(1);
    expect(useTransportStore.getState().baudRate).toBe(9600);
    const transport = useTransportStore.getState().transport!;
    await transport.close();
    await useTransportStore.getState().reopen(115200);
    await settle();
    expect(transport.isOpen).toBe(true);
    expect(relay.streams).toHaveLength(2);
  });
});
