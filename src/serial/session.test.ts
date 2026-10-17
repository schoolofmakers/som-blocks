import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSerialPort, fakeSerial, flush, installSerial } from '../test/fake-serial';
import { useTransportStore } from '../transport/store';
import { bindSerialToTransport } from './session';
import { useSerialStore } from './store';

// The real transport store + WebSerialTransport over a fake port, wired by the session.
describe('bindSerialToTransport', () => {
  let port: FakeSerialPort;
  let uninstall: () => void;
  let unbind: () => void;
  const initialSerial = useSerialStore.getState();
  const initialTransport = useTransportStore.getState();

  beforeEach(() => {
    useTransportStore.setState(initialTransport, true);
    useSerialStore.setState(initialSerial, true);
    useSerialStore.getState().clear();
    port = new FakeSerialPort();
    uninstall = installSerial(fakeSerial(port));
    unbind = bindSerialToTransport();
  });

  afterEach(async () => {
    unbind();
    useSerialStore.getState().stop();
    await useTransportStore.getState().disconnect();
    uninstall();
  });

  it('listens from the moment the connection is published', async () => {
    await useTransportStore.getState().connect('uno');
    expect(useSerialStore.getState().status).toBe('listening');
    port.push([...new TextEncoder().encode('hola\n')]);
    await flush();
    await expect.poll(() => useSerialStore.getState().lines).toEqual(['hola']);
  });

  it('an unplug shows the disconnected notice and keeps the buffer', async () => {
    await useTransportStore.getState().connect('uno');
    port.push([...new TextEncoder().encode('antes\n')]);
    await flush();
    await expect.poll(() => useSerialStore.getState().lines).toEqual(['antes']);
    port.unplug();
    await flush();
    expect(useTransportStore.getState().transport).toBeNull();
    expect(useSerialStore.getState().status).toBe('disconnected');
    expect(useSerialStore.getState().lines).toEqual(['antes']);
  });

  it('a user disconnect goes back to idle', async () => {
    await useTransportStore.getState().connect('uno');
    await useTransportStore.getState().disconnect();
    expect(useSerialStore.getState().status).toBe('idle');
  });
});
