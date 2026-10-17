import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransportStore } from '../transport/store';
import type { Transport } from '../transport/types';
import { SerialPanel, TAB_STORAGE_KEY } from './SerialPanel';
import { useSerialStore } from './store';

vi.mock('./SerialMonitor', () => ({ default: () => <p>monitor-view</p> }));
vi.mock('./SerialPlotter', () => ({ default: () => <p>plot-view</p> }));

const initialSerial = useSerialStore.getState();
const initialTransport = useTransportStore.getState();

describe('SerialPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSerialStore.setState(initialSerial, true);
    useTransportStore.setState(initialTransport, true);
  });

  it('starts collapsed, opens, switches tabs and remembers the tab', async () => {
    const { unmount } = render(<SerialPanel lang="es" />);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    fireEvent.click(screen.getByTestId('serial-panel-toggle'));
    expect(await screen.findByText('monitor-view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Gráfico' }));
    expect(await screen.findByText('plot-view')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(TAB_STORAGE_KEY)).toBe('plot');
    unmount();

    render(<SerialPanel lang="en" />);
    expect(screen.getByRole('tab', { name: 'Plot' })).toHaveAttribute('aria-selected', 'true');
  });

  it('starts listening when the transport connects and stops when it goes away', () => {
    const start = vi.fn(async () => {});
    const stop = vi.fn();
    useSerialStore.setState({ start, stop });
    render(<SerialPanel lang="es" />);
    expect(start).not.toHaveBeenCalled();
    const transport = { kind: 'web-serial' } as Transport;
    act(() => useTransportStore.setState({ transport }));
    expect(start).toHaveBeenCalledWith(transport);
    useSerialStore.setState({ status: 'listening' });
    act(() => useTransportStore.setState({ transport: null }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the disconnected notice when the transport goes away after an unplug', () => {
    const stop = vi.fn();
    useSerialStore.setState({ stop, start: vi.fn(async () => {}) });
    act(() => useTransportStore.setState({ transport: { kind: 'web-serial' } as Transport }));
    render(<SerialPanel lang="es" />);
    useSerialStore.setState({ status: 'disconnected' });
    act(() => useTransportStore.setState({ transport: null }));
    expect(stop).not.toHaveBeenCalled();
  });
});
