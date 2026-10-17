import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompileStore } from '../compile/store';
import { FakeSerialPort, fakeSerial, installSerial } from '../test/fake-serial';
import { fakeTransport } from '../test/fake-transport';
import { useTransportStore } from '../transport/store';
import { useFlashStore } from './store';
import { UploadButton } from './UploadButton';

const initialFlash = useFlashStore.getState();
const initialCompile = useCompileStore.getState();
const initialTransport = useTransportStore.getState();
const CODE = 'void setup() {}';

describe('UploadButton', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    useFlashStore.setState(initialFlash, true);
    useCompileStore.setState(initialCompile, true);
    useTransportStore.setState(initialTransport, true);
    uninstall = installSerial(fakeSerial(new FakeSerialPort()));
  });

  afterEach(() => uninstall());

  const button = () => screen.getByTestId('upload-button');

  it('without Web Serial it is disabled with the browser reason', () => {
    uninstall();
    render(<UploadButton lang="en" code={CODE} boardId="uno" />);
    expect(button()).toBeDisabled();
    expect(screen.getByTestId('upload-reason')).toHaveTextContent(/browser does not allow USB/);
  });

  it('with nothing compiled it is disabled and says to compile first', () => {
    render(<UploadButton lang="es" code={CODE} boardId="uno" />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription('Primero pulsa Compilar.');
  });

  it('compiled but not connected: says to connect', () => {
    useCompileStore.setState({
      status: 'ok',
      result: { kind: 'avr', hex: new Uint8Array(), log: '' },
    });
    render(<UploadButton lang="en" code={CODE} boardId="uno" />);
    expect(button()).toBeDisabled();
    expect(screen.getByTestId('upload-reason')).toHaveTextContent(
      'Connect your board with the Connect button.',
    );
  });

  it('compiled and connected: enabled, and a click starts the upload', () => {
    const upload = vi.fn(async () => {});
    useFlashStore.setState({ upload });
    useCompileStore.setState({
      status: 'ok',
      result: { kind: 'avr', hex: new Uint8Array(), log: '' },
    });
    useTransportStore.setState({ status: 'connected', transport: fakeTransport() });
    render(<UploadButton lang="en" code={CODE} boardId="uno" />);
    expect(button()).toBeEnabled();
    expect(screen.queryByTestId('upload-reason')).toBeNull();
    fireEvent.click(button());
    expect(upload).toHaveBeenCalledWith({ code: CODE, boardId: 'uno' });
  });

  it('shows phase, progress and Cancel while flashing, and the error message after', () => {
    useFlashStore.setState({ status: 'flashing', phase: 'write', percent: 42, canCancel: true });
    const { rerender } = render(<UploadButton lang="es" code={CODE} boardId="uno" />);
    expect(screen.getByTestId('upload-status')).toHaveTextContent('Escribiendo tu programa… 42 %');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42');
    expect(screen.getByTestId('upload-cancel')).toBeInTheDocument();

    useFlashStore.setState({
      status: 'error',
      error: { key: 'UI_UPLOAD_ERR_SYNC_ESP', detail: 'Failed to connect' },
    });
    rerender(<UploadButton lang="es" code={CODE} boardId="uno" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/mantén apretado BOOT/);
    expect(screen.queryByTestId('upload-cancel')).toBeNull();
  });
});
