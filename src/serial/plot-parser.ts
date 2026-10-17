// Parses serial plotter lines into per-label series, the format the `som_serial_plot` block
// prints (`Serial.print("temp:"); Serial.println(x);` → `temp:23.50`). Several pairs per line
// work too, separated by spaces or commas, as in the Arduino IDE 2 plotter: `temp:23.5 hum:40`.
//
// A line counts only when it is made entirely of pairs, so chatter such as
// "Conectando a WiFi: 3 intentos" never draws a line. Arduino prints `nan`/`inf`/`ovf` for
// broken floats: those keep the label and leave a gap. The data is kept in the aligned shape
// uPlot wants (pattern: leeoniya/uPlot demos/missing-data.js, MIT): one shared x array of
// timestamps and one array per series with `null` where that label had no value.

export const DEFAULT_MAX_POINTS = 600;
/** One per colour of the plot palette: a 7th label is ignored, never drawn in a reused colour. */
export const DEFAULT_MAX_SERIES = 6;

const NUMBER = String.raw`[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)|nan|-?inf|ovf`;
const PAIR = String.raw`([^\s:,]+)\s*:\s*(${NUMBER})`;
// A comma right after digits belongs to the number only when a digit follows it ("23,5"),
// otherwise it separates pairs ("a:1,b:2").
const PAIR_RE = new RegExp(String.raw`${PAIR}(?=$|[\s,])`, 'giy');
const SEPARATORS_RE = /[\s,]*/y;

export interface PlotPoint {
  label: string;
  value: number | null;
}

/** Splits one line into pairs; `null` when the line is not a plotter line. */
export function parsePlotLine(line: string): PlotPoint[] | null {
  const points: PlotPoint[] = [];
  let index = 0;
  const text = line.trim();
  if (text === '') return null;
  while (index < text.length) {
    PAIR_RE.lastIndex = index;
    const match = PAIR_RE.exec(text);
    if (!match) return null;
    const [, label = '', raw = ''] = match;
    points.push({ label, value: toNumber(raw) });
    SEPARATORS_RE.lastIndex = PAIR_RE.lastIndex;
    SEPARATORS_RE.exec(text);
    index = SEPARATORS_RE.lastIndex;
  }
  return points.length > 0 ? points : null;
}

function toNumber(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export interface PlotSeries {
  label: string;
  /** Colour slot, 0-based. Stays with the label while it is on screen (colour follows the
   * entity), and a freed slot is reused by the next new label. */
  slot: number;
  values: (number | null)[];
}

export interface PlotSnapshot {
  /** Seconds since the epoch (uPlot's time scale unit), one per accepted line. */
  times: number[];
  series: PlotSeries[];
}

export const EMPTY_PLOT: PlotSnapshot = { times: [], series: [] };

export interface PlotParserOptions {
  maxPoints?: number;
  maxSeries?: number;
}

/** Keeps the last `maxPoints` plotter lines as aligned series. Pure, DOM-free. */
export class PlotParser {
  readonly maxPoints: number;
  readonly maxSeries: number;
  private times: number[] = [];
  private series: PlotSeries[] = [];

  constructor({
    maxPoints = DEFAULT_MAX_POINTS,
    maxSeries = DEFAULT_MAX_SERIES,
  }: PlotParserOptions = {}) {
    this.maxPoints = maxPoints;
    this.maxSeries = maxSeries;
  }

  /** Adds one line received at `timeMs`; returns whether it was a plotter line. */
  push(line: string, timeMs: number): boolean {
    const points = parsePlotLine(line);
    if (!points) return false;
    const row = new Map<string, number | null>();
    for (const { label, value } of points) {
      const known = this.series.some((s) => s.label === label);
      if (!known) {
        // More labels than colours would make the chart unreadable: extra labels are ignored.
        if (this.series.length >= this.maxSeries) continue;
        this.series.push({ label, slot: this.freeSlot(), values: this.times.map(() => null) });
      }
      row.set(label, value);
    }
    if (row.size === 0) return false;
    this.times.push(timeMs / 1000);
    for (const s of this.series)
      s.values.push(row.has(s.label) ? (row.get(s.label) ?? null) : null);
    this.trim();
    return true;
  }

  snapshot(): PlotSnapshot {
    return {
      times: this.times.slice(),
      series: this.series.map((s) => ({ ...s, values: s.values.slice() })),
    };
  }

  clear(): void {
    this.times = [];
    this.series = [];
  }

  private freeSlot(): number {
    let slot = 0;
    while (this.series.some((s) => s.slot === slot)) slot += 1;
    return slot;
  }

  private trim(): void {
    const extra = this.times.length - this.maxPoints;
    if (extra <= 0) return;
    this.times.splice(0, extra);
    for (const s of this.series) s.values.splice(0, extra);
    // A label that scrolled out of the window entirely frees its slot (and its legend entry).
    this.series = this.series.filter((s) => s.values.some((v) => v !== null));
  }
}
