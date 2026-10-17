import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransportStore } from '../transport/store';
import SerialMonitor from './SerialMonitor';
import { useSerialStore } from './store';

const terminals = vi.hoisted(
  () =>
    [] as {
      written: string[];
      resets: number;
      disposed: boolean;
      opened: HTMLElement | null;
    }[],
);
const fits = vi.hoisted(() => ({ count: 0 }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    buffer = { active: { viewportY: 0 } };
    record = {
      written: [] as string[],
      resets: 0,
      disposed: false,
      opened: null as HTMLElement | null,
    };
    constructor() {
      terminals.push(this.record);
    }
    loadAddon() {}
    open(el: HTMLElement) {
      this.record.opened = el;
    }
    write(text: string, cb?: () => void) {
      this.record.written.push(text);
      cb?.();
    }
    reset() {
      this.record.resets += 1;
    }
    scrollToBottom() {}
    scrollToLine() {}
    dispose() {
      this.record.disposed = true;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      fits.count += 1;
    }
  },
}));

const initialSerial = useSerialStore.getState();
const initialTransport = useTransportStore.getState();

describe('SerialMonitor', () => {
  beforeEach(() => {
    terminals.length = 0;
    useTransportStore.setState(initialTransport, true);
    useSerialStore.setState(initialSerial, true);
    useSerialStore.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('without a connection shows the "connect first" hint and disables sending', () => {
    render(<SerialMonitor lang="es" />);
    expect(screen.getByTestId('serial-notice')).toHaveTextContent('Conecta tu placa primero');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('writes the buffered lines into the terminal and disposes it on unmount', () => {
    useSerialStore.setState({ lines: ['hola', 'mundo'], totalLines: 2, partial: 'x' });
    const { unmount } = render(<SerialMonitor lang="es" />);
    const term = terminals[0]!;
    expect(term.opened).toBe(screen.getByTestId('serial-terminal'));
    expect(term.written.join('')).toBe('hola\r\nmundo\r\nx');
    act(() =>
      useSerialStore.setState({ lines: ['hola', 'mundo', 'xy'], totalLines: 3, partial: '' }),
    );
    expect(term.written.at(-1)).toBe('\r\x1b[Jxy\r\n');
    unmount();
    expect(term.disposed).toBe(true);
  });

  it('toolbar: baud, pause/resume, clear, autoscroll', () => {
    const setBaud = vi.spyOn(useSerialStore.getState(), 'setBaud');
    useSerialStore.setState({ setBaud });
    render(<SerialMonitor lang="en" />);
    fireEvent.change(screen.getByLabelText('Speed (baud)'), { target: { value: '9600' } });
    expect(setBaud).toHaveBeenCalledWith(9600);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useSerialStore.getState().paused).toBe(true);
    expect(screen.getByTestId('serial-notice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(useSerialStore.getState().paused).toBe(false);

    useSerialStore.setState({ lines: ['a'], totalLines: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useSerialStore.getState().lines).toEqual([]);
    expect(terminals[0]!.resets).toBe(1);

    fireEvent.click(screen.getByLabelText('Auto-scroll'));
    expect(useSerialStore.getState().autoscroll).toBe(false);
  });

  it('sends the message with the chosen line ending', () => {
    const send = vi.fn(async () => {});
    useSerialStore.setState({ status: 'listening', send });
    render(<SerialMonitor lang="en" />);
    fireEvent.change(screen.getByLabelText('Line ending'), { target: { value: '\r\n' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message for the board' }), {
      target: { value: 'led on' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('led on', '\r\n');
    expect(screen.getByRole('textbox', { name: 'Message for the board' })).toHaveValue('');
  });

  it('downloads the whole buffer as a .txt file', () => {
    useSerialStore.setState({ exportLog: () => 'a\nb\n' });
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:log');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<SerialMonitor lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download .txt' }));
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^serial-\d{8}-\d{4}\.txt$/);
    expect(createObjectURL.mock.calls[0]![0].type).toBe('text/plain');
  });

  it('shows the disconnected notice and the muted notice', () => {
    useSerialStore.setState({ status: 'disconnected' });
    const { rerender } = render(<SerialMonitor lang="en" />);
    expect(screen.getByTestId('serial-notice')).toHaveTextContent('The board was disconnected');
    act(() => useSerialStore.setState({ muted: true }));
    rerender(<SerialMonitor lang="en" />);
    expect(screen.getByTestId('serial-notice')).toHaveTextContent('Uploading your program');
  });
});
