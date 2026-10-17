import { describe, expect, it } from 'vitest';
import { terminalUpdate } from './terminal-text';

describe('terminalUpdate', () => {
  it('writes only the new lines', () => {
    expect(
      terminalUpdate(
        { total: 1, partial: '' },
        { lines: ['a', 'b', 'c'], totalLines: 3, partial: '' },
        80,
      ),
    ).toEqual({ reset: false, text: 'b\r\nc\r\n' });
  });

  it('appends to a growing partial line', () => {
    expect(
      terminalUpdate(
        { total: 0, partial: 'va' },
        { lines: [], totalLines: 0, partial: 'valor' },
        80,
      ),
    ).toEqual({ reset: false, text: 'lor' });
  });

  it('replaces the partial line once it completes', () => {
    expect(
      terminalUpdate(
        { total: 0, partial: 'val' },
        { lines: ['valor:1'], totalLines: 1, partial: 'x' },
        80,
      ),
    ).toEqual({ reset: false, text: '\r\x1b[Jvalor:1\r\nx' });
  });

  it('moves up over the rows a wrapped partial line takes', () => {
    const update = terminalUpdate(
      { total: 0, partial: 'x'.repeat(25) },
      { lines: ['done'], totalLines: 1, partial: '' },
      10,
    );
    expect(update.text).toBe('\r\x1b[2A\x1b[Jdone\r\n');
  });

  it('redraws everything after a clear or when more lines arrived than the buffer holds', () => {
    expect(
      terminalUpdate({ total: 5, partial: '' }, { lines: [], totalLines: 0, partial: '' }, 80),
    ).toEqual({ reset: true, text: '' });
    expect(
      terminalUpdate(
        { total: 0, partial: '' },
        { lines: ['y', 'z'], totalLines: 9, partial: 'p' },
        80,
      ),
    ).toEqual({ reset: true, text: 'y\r\nz\r\np' });
  });

  it('writes nothing when nothing changed', () => {
    expect(
      terminalUpdate(
        { total: 2, partial: 'p' },
        { lines: ['a', 'b'], totalLines: 2, partial: 'p' },
        80,
      ),
    ).toEqual({ reset: false, text: '' });
  });
});
