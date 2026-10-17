import { describe, expect, it } from 'vitest';
import { parsePlotLine, PlotParser } from './plot-parser';

describe('parsePlotLine', () => {
  it('reads what the som_serial_plot block prints', () => {
    // Serial.print("temperatura:"); Serial.println(23.5) → "temperatura:23.50"
    expect(parsePlotLine('temperatura:23.50')).toEqual([{ label: 'temperatura', value: 23.5 }]);
  });

  it('reads several pairs separated by spaces or commas', () => {
    expect(parsePlotLine('temp:23.5 hum:40')).toEqual([
      { label: 'temp', value: 23.5 },
      { label: 'hum', value: 40 },
    ]);
    expect(parsePlotLine('a:1,b:-2, c:+3')).toEqual([
      { label: 'a', value: 1 },
      { label: 'b', value: -2 },
      { label: 'c', value: 3 },
    ]);
  });

  it('accepts a comma decimal and spaces around the colon', () => {
    expect(parsePlotLine('luz : 12,75')).toEqual([{ label: 'luz', value: 12.75 }]);
    expect(parsePlotLine('x:.5')).toEqual([{ label: 'x', value: 0.5 }]);
  });

  it('keeps nan/inf/ovf as a gap', () => {
    expect(parsePlotLine('t:nan h:inf v:ovf')).toEqual([
      { label: 't', value: null },
      { label: 'h', value: null },
      { label: 'v', value: null },
    ]);
  });

  it('ignores lines that are not entirely label:value pairs', () => {
    for (const line of [
      '',
      'hola mundo',
      '42',
      'Conectando a WiFi: 3 intentos',
      'hora:12:30',
      'temp:alta',
      'temp:23 grados',
      ':5',
    ]) {
      expect(parsePlotLine(line), line).toBeNull();
    }
  });
});

describe('PlotParser', () => {
  it('aligns series on one time axis with gaps for missing labels', () => {
    const parser = new PlotParser();
    expect(parser.push('a:1', 1000)).toBe(true);
    expect(parser.push('a:2 b:5', 2000)).toBe(true);
    expect(parser.push('b:6', 3000)).toBe(true);
    expect(parser.push('no es un dato', 4000)).toBe(false);
    expect(parser.snapshot()).toEqual({
      times: [1, 2, 3],
      series: [
        { label: 'a', slot: 0, values: [1, 2, null] },
        { label: 'b', slot: 1, values: [null, 5, 6] },
      ],
    });
  });

  it('keeps a bounded window and drops labels that left it', () => {
    const parser = new PlotParser({ maxPoints: 2 });
    parser.push('old:1', 0);
    parser.push('new:2', 1000);
    parser.push('new:3', 2000);
    const { times, series } = parser.snapshot();
    expect(times).toEqual([1, 2]);
    expect(series).toEqual([{ label: 'new', slot: 1, values: [2, 3] }]);
    // The freed colour slot goes to the next new label; "new" keeps its colour.
    parser.push('next:4', 3000);
    expect(parser.snapshot().series.map((s) => [s.label, s.slot])).toEqual([
      ['new', 1],
      ['next', 0],
    ]);
  });

  it('ignores labels beyond maxSeries instead of reusing colours', () => {
    const parser = new PlotParser({ maxSeries: 2 });
    expect(parser.push('a:1 b:2 c:3', 0)).toBe(true);
    expect(parser.snapshot().series.map((s) => s.label)).toEqual(['a', 'b']);
  });

  it('admits new labels once old ones scroll out, instead of freezing', () => {
    const parser = new PlotParser({ maxSeries: 2, maxPoints: 2 });
    parser.push('a:1 b:2', 0);
    // Only new labels from now on: time still moves, so a and b leave the window.
    expect(parser.push('c:3 d:4', 1000)).toBe(true);
    expect(parser.push('c:5 d:6', 2000)).toBe(true);
    expect(parser.push('c:7 d:8', 3000)).toBe(true);
    const { times, series } = parser.snapshot();
    expect(times).toEqual([2, 3]);
    expect(series.map((s) => [s.label, s.slot])).toEqual([
      ['c', 0],
      ['d', 1],
    ]);
  });

  it('keeps a label that keeps arriving as nan in the legend', () => {
    const parser = new PlotParser({ maxPoints: 2 });
    parser.push('t:20', 0);
    parser.push('t:nan', 1000);
    parser.push('t:nan', 2000);
    expect(parser.snapshot().series).toEqual([{ label: 't', slot: 0, values: [null, null] }]);
  });

  it('snapshots are copies and clear() empties everything', () => {
    const parser = new PlotParser();
    parser.push('a:1', 0);
    const snap = parser.snapshot();
    parser.push('a:2', 1000);
    expect(snap.times).toEqual([0]);
    parser.clear();
    expect(parser.snapshot()).toEqual({ times: [], series: [] });
  });
});
