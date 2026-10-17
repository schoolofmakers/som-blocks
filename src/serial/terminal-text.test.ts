import { describe, expect, it } from 'vitest';
import { cursorRowOffset, terminalUpdate } from './terminal-text';

describe('cursorRowOffset', () => {
  it('counts wrapped rows per \\r segment and ignores control codes', () => {
    expect(cursorRowOffset('', 10)).toBe(0);
    expect(cursorRowOffset('x'.repeat(10), 10)).toBe(0); // pending wrap, same row
    expect(cursorRowOffset('x'.repeat(11), 10)).toBe(1);
    expect(cursorRowOffset('10%\r20%\r30%', 10)).toBe(0);
    // A wrapped segment moves the cursor down; the \r after it stays on that last row.
    expect(cursorRowOffset(`${'a'.repeat(25)}\rbb`, 10)).toBe(2);
    expect(cursorRowOffset(`\x1b[31m${'r'.repeat(10)}\x1b[0m`, 10)).toBe(0);
  });
});

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

  it('a \\r progress line stays on one row, so finishing it moves up nothing', () => {
    const progress = Array.from({ length: 40 }, (_, i) => `${i}%`).join('\r'); // ~120 chars
    expect(
      terminalUpdate(
        { total: 0, partial: progress },
        { lines: [`${progress}\rlisto`], totalLines: 1, partial: '' },
        10,
      ).text.startsWith('\r\x1b[J'),
    ).toBe(true);
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
