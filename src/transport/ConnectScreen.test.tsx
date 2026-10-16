import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOARD_ID } from '../boards/registry';
import { useBoardStore } from '../boards/store';
import { FakeSerialPort, fakeSerial, installSerial } from '../test/fake-serial';
import { ConnectButton, ConnectScreen } from './ConnectScreen';
import { useTransportStore } from './store';

const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const initial = useTransportStore.getState();

describe('ConnectScreen', () => {
  beforeEach(() => {
    useBoardStore.setState({ boardId: DEFAULT_BOARD_ID });
    useTransportStore.setState(initial, true);
  });

  afterEach(async () => {
    await useTransportStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  it('in an unsupported browser shows the reason and disables USB (es)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(FIREFOX);
    render(<ConnectScreen lang="es" />);
    expect(screen.getByRole('dialog', { name: 'Conectar tu placa' })).toBeInTheDocument();
    expect(screen.getByTestId('connect-board')).toHaveTextContent('ESP32-C3 SuperMini');
    expect(screen.getByTestId('support-usb')).toHaveTextContent('No disponible');
    expect(screen.getByTestId('support-wifi')).toHaveTextContent('Próximamente');
    expect(screen.getByTestId('support-reason')).toHaveTextContent(
      'Firefox no puede usar USB. Abre el editor en Chrome o Edge.',
    );
    const button = screen.getByRole('button', { name: 'Conectar por USB' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Firefox no puede usar USB/);
    expect(screen.queryByText('Mostrar todos los puertos')).not.toBeInTheDocument();
  });

  describe('with Web Serial', () => {
    let uninstall: () => void;
    let port: FakeSerialPort;
    afterEach(() => uninstall());

    it('connects over USB with the selected board filters, then disconnects (en)', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME);
      port = new FakeSerialPort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
      const serial = fakeSerial(port);
      uninstall = installSerial(serial);
      render(<ConnectScreen lang="en" />);

      expect(screen.getByTestId('support-usb')).toHaveTextContent('Available');
      expect(screen.queryByTestId('support-reason')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Connect over USB' }));
      // Synchronously inside the click: the chooser keeps its user activation.
      expect(serial.requestPort).toHaveBeenCalledWith({ filters: [{ usbVendorId: 0x303a }] });

      expect(await screen.findByTestId('connect-port')).toHaveTextContent(
        'Connected to ESP32-C3 SuperMini · 303a:1001',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByRole('button', { name: 'Connect over USB' })).toBeEnabled();
      expect(port.closeCalls).toBe(1);
    });

    it('offers remembered ports and explains a cancelled chooser', async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME);
      port = new FakeSerialPort();
      const serial = fakeSerial(port, [port]);
      serial.requestPort.mockRejectedValue(new DOMException('none', 'NotFoundError'));
      uninstall = installSerial(serial);
      render(<ConnectScreen lang="es" />);

      expect(
        await screen.findByRole('button', { name: 'Reconectar: Arduino UNO · 1a86:7523' }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos los puertos' }));
      expect(serial.requestPort).toHaveBeenCalledWith({});
      expect(await screen.findByRole('alert')).toHaveTextContent('No elegiste ningún puerto.');
    });
  });
});

describe('ConnectButton', () => {
  beforeEach(() => useTransportStore.setState(initial, true));

  it('shows the status and toggles the connect screen', () => {
    render(<ConnectButton lang="es" />);
    const button = screen.getByRole('button', { name: 'Conectar' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Conectar tu placa' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('reflects the connected status', async () => {
    useTransportStore.setState({ status: 'connected' });
    render(<ConnectButton lang="en" />);
    await waitFor(() =>
      expect(screen.getByTestId('connect-status')).toHaveTextContent('Connected'),
    );
  });
});
