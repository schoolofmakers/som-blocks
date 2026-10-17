import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { t, type Lang } from '../i18n/messages';
import type { PlotSnapshot } from './plot-parser';
import { useSerialStore } from './store';

// Serial plotter: a uPlot (MIT) line chart of the `label:value` series the serial store
// parses. Lazy-loaded by SerialPanel, so uPlot is its own chunk.
//
// Pattern: leeoniya/uPlot README "data updates" + demos/nearest-non-null.js: build the chart
// once per set of series and stream with `setData()` (the x scale follows the data), with
// `spanGaps` so a label that skips a line does not break its line. Differences: the series
// set changes while streaming (a new label appears), so the chart is rebuilt only when the
// labels change, and it is sized from a ResizeObserver on its host instead of the window.
// Colours are the --som-series-* tokens, by the slot the parser keeps per label.

const CHART_HEIGHT = 200;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function toData(snapshot: PlotSnapshot): uPlot.AlignedData {
  return [snapshot.times, ...snapshot.series.map((s) => s.values)];
}

function useColorScheme(): string {
  const [scheme, setScheme] = useState('light');
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setScheme(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return scheme;
}

interface SerialPlotterProps {
  lang: Lang;
}

export default function SerialPlotter({ lang }: SerialPlotterProps) {
  const snapshot = useSerialStore((s) => s.series);
  const paused = useSerialStore((s) => s.paused);
  const scheme = useColorScheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const empty = snapshot.series.length === 0;
  // Rebuild only when the set of series (or the theme) changes; data alone streams in.
  const seriesKey = snapshot.series.map((s) => `${s.slot}:${s.label}`).join('\n');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || seriesKey === '') return;
    const current = useSerialStore.getState().series;
    const axis: uPlot.Axis = {
      stroke: cssVar('--som-muted', '#475569'),
      grid: { stroke: cssVar('--som-border', '#cbd5e1'), width: 1 },
      ticks: { stroke: cssVar('--som-border', '#cbd5e1'), width: 1 },
    };
    const plot = new uPlot(
      {
        width: Math.max(host.clientWidth, 200),
        height: CHART_HEIGHT,
        scales: { x: { time: true } },
        axes: [axis, axis],
        cursor: { drag: { x: false, y: false } },
        series: [
          {},
          ...current.series.map((s) => ({
            label: s.label,
            stroke: cssVar(`--som-series-${s.slot + 1}`, '#2a78d6'),
            width: 2,
            spanGaps: true,
            points: { show: false },
          })),
        ],
      },
      toData(current),
      host,
    );
    plotRef.current = plot;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (host.clientWidth > 0)
              plot.setSize({ width: host.clientWidth, height: CHART_HEIGHT });
          })
        : null;
    observer?.observe(host);
    return () => {
      observer?.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [seriesKey, scheme]);

  useEffect(() => {
    plotRef.current?.setData(toData(snapshot));
  }, [snapshot]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={paused}
          className="min-h-9 rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          onClick={() => useSerialStore.getState().setPaused(!paused)}
        >
          {t(paused ? 'UI_SERIAL_RESUME' : 'UI_SERIAL_PAUSE', lang)}
        </button>
        <button
          type="button"
          className="min-h-9 rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          onClick={() => useSerialStore.getState().clear()}
        >
          {t('UI_SERIAL_CLEAR', lang)}
        </button>
      </div>
      {empty && (
        <p data-testid="plot-empty" className="text-sm text-muted">
          {t('UI_PLOT_EMPTY', lang)}
        </p>
      )}
      <div
        ref={hostRef}
        role="figure"
        aria-label={t('UI_PLOT_CHART', lang)}
        data-testid="serial-plot"
        className="min-h-0 flex-1 overflow-hidden text-xs text-fg"
        hidden={empty}
      />
    </div>
  );
}
