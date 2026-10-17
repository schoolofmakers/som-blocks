import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SerialPlotter from './SerialPlotter';
import { useSerialStore } from './store';

interface FakePlot {
  opts: { series: { label?: string; stroke?: string }[] };
  data: unknown[];
  destroyed: boolean;
}

const plots = vi.hoisted(() => [] as FakePlot[]);

vi.mock('uplot', () => ({
  default: class {
    record: FakePlot;
    constructor(opts: FakePlot['opts'], data: unknown[]) {
      this.record = { opts, data, destroyed: false };
      plots.push(this.record);
    }
    setData(data: unknown[]) {
      this.record.data = data;
    }
    setSize() {}
    destroy() {
      this.record.destroyed = true;
    }
  },
}));

const initial = useSerialStore.getState();

describe('SerialPlotter', () => {
  beforeEach(() => {
    plots.length = 0;
    useSerialStore.setState(initial, true);
  });

  it('shows the hint while there is nothing to plot', () => {
    render(<SerialPlotter lang="es" />);
    expect(screen.getByTestId('plot-empty')).toHaveTextContent('graficar');
    expect(plots).toHaveLength(0);
  });

  it('builds the chart per set of labels and streams data with setData', () => {
    useSerialStore.setState({
      series: { times: [1], series: [{ label: 'temp', slot: 0, values: [20] }] },
    });
    const { unmount } = render(<SerialPlotter lang="en" />);
    expect(plots).toHaveLength(1);
    expect(plots[0]!.opts.series.map((s) => s.label)).toEqual([undefined, 'temp']);

    act(() =>
      useSerialStore.setState({
        series: { times: [1, 2], series: [{ label: 'temp', slot: 0, values: [20, 21] }] },
      }),
    );
    expect(plots).toHaveLength(1);
    expect(plots[0]!.data).toEqual([
      [1, 2],
      [20, 21],
    ]);

    act(() =>
      useSerialStore.setState({
        series: {
          times: [1, 2, 3],
          series: [
            { label: 'temp', slot: 0, values: [20, 21, null] },
            { label: 'hum', slot: 1, values: [null, null, 40] },
          ],
        },
      }),
    );
    expect(plots).toHaveLength(2);
    expect(plots[0]!.destroyed).toBe(true);
    expect(plots[1]!.opts.series.map((s) => s.label)).toEqual([undefined, 'temp', 'hum']);
    unmount();
    expect(plots[1]!.destroyed).toBe(true);
  });

  it('pauses together with the monitor', () => {
    render(<SerialPlotter lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useSerialStore.getState().paused).toBe(true);
  });
});
