import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeSerialPort,
  fakeSerial,
  flush,
  installSerial,
  type FakeSerial,
} from '../test/fake-serial';
import { DEFAULT_BAUD_RATE, useTransportStore } from './store';

const initial = useTransportStore.getState();

describe('transport store', () => {
  let port: FakeSerialPort;
  let serial: FakeSerial;
  let uninstall: () => void;

  beforeEach(() => {
    useTransportStore.setState(initial, true);
    port = new FakeSerialPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    serial = fakeSerial(port);
    uninstall = installSerial(serial);
  });

  afterEach(async () => {
    await useTransportStore.getState().disconnect();
    uninstall();
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

  it('an unplug turns connected into an explicit disconnected error', async () => {
    await useTransportStore.getState().connect('uno');
    port.unplug();
    await flush();
    expect(useTransportStore.getState()).toMatchObject({
      status: 'error',
      error: { key: 'UI_CONNECT_ERROR_DISCONNECTED' },
      transport: null,
      portLabel: null,
    });
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
    await useTransportStore.getState().reopen(9600);
    expect(useTransportStore.getState()).toMatchObject({
      status: 'error',
      error: { key: 'UI_CONNECT_ERROR_OPEN_FAILED', detail: 'Failed to open serial port.' },
      transport: null,
    });
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
