import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProjectsStore, useProjectsStore } from '../projects/store';
import { MemoryProjectRepo } from '../projects/db';
import { useSerialStore } from '../serial/store';
import { FakeSerialPort, fakeSerial, installSerial } from '../test/fake-serial';
import { useTransportStore } from '../transport/store';
import { ProvisionDialog } from './ProvisionDialog';
import { WifiConnect } from './WifiConnect';

// The two Improv SDKs, mocked at the module boundary: what our adapter (improv.ts), the port
// lending (provision.ts) and the dialog do around them is real.

const DEVICE = 'fa4e00c3c3c3';
const TOKEN = 'ab'.repeat(32);
const URL_OK = `https://blocks.example.cl/pair?device=${DEVICE}&token=${TOKEN}`;

const h = vi.hoisted(() => ({
  serial: {
    initialize: vi.fn<() => Promise<void>>(),
    scan: vi.fn<() => Promise<{ name: string; rssi: number; secured: boolean }[]>>(),
    provision:
      vi.fn<
        (this: EventTarget & { nextUrl?: string }, ssid: string, pw: string) => Promise<void>
      >(),
    close: vi.fn<() => Promise<void>>(),
    port: undefined as unknown,
  },
  ble: {
    initialState: 2,
    provision: vi.fn<(ssid: string, pw: string) => Promise<string | undefined>>(),
    errorState: 0,
    instance: undefined as (EventTarget & { currentState?: number }) | undefined,
  },
}));

vi.mock('improv-wifi-serial-sdk/dist/serial.js', () => ({
  ImprovSerial: class extends EventTarget {
    info = { name: 'SoM-C3' };
    nextUrl: string | undefined;
    constructor(port: unknown) {
      super();
      h.serial.port = port;
    }
    initialize() {
      return h.serial.initialize();
    }
    scan() {
      return h.serial.scan();
    }
    provision(ssid: string, pw: string) {
      return h.serial.provision.call(this, ssid, pw);
    }
    close() {
      return h.serial.close();
    }
  },
}));

vi.mock('improv-wifi-sdk/dist/ble.js', () => ({
  ImprovBluetoothLE: class extends EventTarget {
    currentState = h.ble.initialState;
    get errorState() {
      return h.ble.errorState;
    }
    constructor() {
      super();
      h.ble.instance = this;
    }
    async initialize() {}
    provision(ssid: string, pw: string) {
      return h.ble.provision(ssid, pw);
    }
    close() {}
  },
}));

const initialTransport = useTransportStore.getState();
const initialSerial = useSerialStore.getState();

async function openProject() {
  resetProjectsStore();
  await useProjectsStore.getState().init({ repo: new MemoryProjectRepo() });
}

function fillAndSubmit(ssid = 'Sala 12', password = 'secreto') {
  fireEvent.change(screen.getByTestId('provision-ssid'), { target: { value: ssid } });
  fireEvent.change(screen.getByTestId('provision-password'), { target: { value: password } });
  fireEvent.click(screen.getByTestId('provision-submit'));
}

describe('ProvisionDialog over the cable', () => {
  let port: FakeSerialPort;
  let uninstall: () => void;

  beforeEach(async () => {
    useTransportStore.setState(initialTransport, true);
    useSerialStore.setState(initialSerial, true);
    port = new FakeSerialPort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    uninstall = installSerial(fakeSerial(port, [port]));
    await openProject();
    h.serial.initialize.mockReset().mockResolvedValue(undefined);
    h.serial.scan.mockReset().mockResolvedValue([
      { name: 'Sala 12', rssi: -40, secured: true },
      { name: 'Invitados', rssi: -70, secured: false },
    ]);
    h.serial.close.mockReset().mockResolvedValue(undefined);
    h.serial.provision.mockReset().mockImplementation(async function (
      this: EventTarget & { nextUrl?: string },
    ) {
      this.dispatchEvent(new CustomEvent('state-changed', { detail: 0x03 }));
      this.nextUrl = URL_OK;
    });
  });

  afterEach(async () => {
    await useTransportStore.getState().disconnect();
    uninstall();
  });

  it('lends the open USB port, provisions, saves the pairing and gives the port back', async () => {
    await useTransportStore.getState().connect('esp32c3-supermini');
    const usb = useTransportStore.getState().transport!;
    const onClose = vi.fn();
    render(
      <ProvisionDialog lang="es" kind="serial" boardId="esp32c3-supermini" onClose={onClose} />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Conectar la placa a WiFi (por cable)' }),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId('provision-find'));
    await screen.findByTestId('provision-ssid');
    // Our transport let go; the SDK got the same port, open at 115200; the monitor is muted.
    expect(usb.isOpen).toBe(false);
    expect(h.serial.port).toBe(port);
    expect(port.baudRate).toBe(115200);
    expect(useSerialStore.getState().muted).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId('provision-networks').querySelectorAll('option')).toHaveLength(2),
    );

    fillAndSubmit();
    expect(await screen.findByTestId('provision-done')).toHaveTextContent(
      'Placa SoM-C3 conectada a WiFi y emparejada con este proyecto.',
    );
    expect(h.serial.provision).toHaveBeenCalledWith('Sala 12', 'secreto');
    expect(useProjectsStore.getState().current?.wifi).toMatchObject({
      deviceId: DEVICE,
      token: TOKEN,
      name: 'SoM-C3',
    });
    // The token is stored, never shown.
    expect(document.body.textContent).not.toContain(TOKEN);
    await waitFor(() => expect(usb.isOpen).toBe(true));
    expect(h.serial.close).toHaveBeenCalled();
    expect(useSerialStore.getState().muted).toBe(false);
    fireEvent.click(screen.getByTestId('provision-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('a wrong password keeps the board connected and asks again', async () => {
    h.serial.provision.mockRejectedValueOnce('UNABLE_TO_CONNECT');
    render(
      <ProvisionDialog lang="en" kind="serial" boardId="esp32c3-supermini" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('provision-find'));
    await screen.findByTestId('provision-ssid');
    fillAndSubmit('Sala 12', 'mala');
    expect(await screen.findByTestId('provision-error')).toHaveTextContent(
      'The board could not join the network. Check the name and the password.',
    );
    expect(screen.getByTestId('provision-password')).toHaveValue('');
    expect(h.serial.close).not.toHaveBeenCalled();
    fillAndSubmit('Sala 12', 'buena');
    expect(await screen.findByTestId('provision-done')).toBeInTheDocument();
    expect(useProjectsStore.getState().current?.wifi?.deviceId).toBe(DEVICE);
  });

  it('a board without the resident firmware (no Improv answer) says so and frees the port', async () => {
    h.serial.initialize.mockRejectedValueOnce(new Error('Improv Wi-Fi Serial not detected'));
    render(
      <ProvisionDialog lang="es" kind="serial" boardId="esp32c3-supermini" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('provision-find'));
    expect(await screen.findByTestId('provision-error')).toHaveTextContent(
      'La placa no respondió. Revisa que esté preparada para WiFi y vuelve a intentar.',
    );
    expect(port.readable).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(screen.getByTestId('provision-find')).toBeInTheDocument();
  });

  it('a provisioned URL without a valid pairing is an error, nothing is stored', async () => {
    h.serial.provision.mockImplementationOnce(async function (
      this: EventTarget & { nextUrl?: string },
    ) {
      this.nextUrl = 'https://blocks.example.cl/';
    });
    render(
      <ProvisionDialog lang="es" kind="serial" boardId="esp32c3-supermini" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('provision-find'));
    await screen.findByTestId('provision-ssid');
    fillAndSubmit();
    expect(await screen.findByTestId('provision-error')).toHaveTextContent(
      'La placa no envió sus datos para emparejarla.',
    );
    expect(useProjectsStore.getState().current?.wifi).toBeUndefined();
  });
});

describe('ProvisionDialog over Bluetooth', () => {
  let requestDevice: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await openProject();
    requestDevice = vi.fn(async () => ({ name: 'SoM-BLE' }));
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: { requestDevice },
    });
    h.ble.initialState = 1; // authorization required
    h.ble.errorState = 0;
    h.ble.provision.mockReset().mockResolvedValue(URL_OK);
  });

  afterEach(() => {
    delete (navigator as { bluetooth?: unknown }).bluetooth;
  });

  it('asks for the BOOT button, then provisions and pairs', async () => {
    render(<ProvisionDialog lang="es" kind="ble" boardId="esp32c3-supermini" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('provision-find'));
    // Synchronously inside the click: the chooser keeps its user activation.
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: ['00467768-6228-2272-4663-277478268000'] }],
    });
    await screen.findByTestId('provision-ssid');
    fillAndSubmit();
    expect(await screen.findByTestId('provision-status')).toHaveTextContent(
      'Aprieta el botón BOOT de la placa para dar permiso.',
    );
    h.ble.instance!.currentState = 2;
    h.ble.instance!.dispatchEvent(new CustomEvent('state-changed'));
    expect(await screen.findByTestId('provision-done')).toHaveTextContent('Placa SoM-BLE');
    expect(useProjectsStore.getState().current?.wifi?.token).toBe(TOKEN);
  });

  it('closing the chooser is "no board chosen", a BLE error state is explained', async () => {
    requestDevice.mockRejectedValueOnce(new DOMException('cancelled', 'NotFoundError'));
    render(<ProvisionDialog lang="es" kind="ble" boardId="esp32c3-supermini" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('provision-find'));
    expect(await screen.findByTestId('provision-error')).toHaveTextContent(
      'No elegiste ninguna placa.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    h.ble.initialState = 2;
    h.ble.provision.mockResolvedValueOnce(undefined);
    h.ble.errorState = 0x03;
    fireEvent.click(screen.getByTestId('provision-find'));
    await screen.findByTestId('provision-ssid');
    fillAndSubmit();
    expect(await screen.findByTestId('provision-error')).toHaveTextContent(
      'La placa no pudo entrar a la red.',
    );
  });
});

describe('WifiConnect', () => {
  beforeEach(async () => {
    useTransportStore.setState(initialTransport, true);
    await openProject();
  });

  it('in a browser without Web Serial or Web Bluetooth disables both and says why', () => {
    render(<WifiConnect lang="es" boardId="esp32c3-supermini" />);
    expect(screen.getByTestId('provision-serial')).toBeDisabled();
    expect(screen.getByTestId('provision-ble')).toBeDisabled();
    expect(screen.getByTestId('wifi-provision-hint')).toHaveTextContent(
      'Por cable necesitas Chrome o Edge en un computador; por Bluetooth, Chrome en Android.',
    );
    expect(screen.queryByTestId('connect-wifi')).not.toBeInTheDocument();
  });

  it('offers "Conectar por WiFi" once the project has a pairing; boards without WiFi say so', async () => {
    await useProjectsStore.getState().setPairing({
      deviceId: DEVICE,
      token: TOKEN,
      name: 'Azul',
      relayUrl: 'http://relay.test',
    });
    const { rerender } = render(<WifiConnect lang="es" boardId="esp32c3-supermini" />);
    expect(screen.getByTestId('wifi-paired')).toHaveTextContent('Placa de este proyecto: Azul');
    expect(screen.getByTestId('connect-wifi')).toHaveTextContent('Conectar por WiFi');
    rerender(<WifiConnect lang="es" boardId="uno" />);
    expect(screen.getByTestId('wifi-unsupported-board')).toHaveTextContent(
      'Esta placa no tiene WiFi. Usa el cable USB.',
    );
  });
});
