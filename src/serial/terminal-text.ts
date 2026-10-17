// Works out what to write into the terminal to go from what it shows to the store's snapshot,
// so the terminal is fed incrementally (one write per frame) instead of being redrawn.
// Pure: the monitor component owns the xterm instance and just writes the result.

export interface Shown {
  /** `totalLines` of the last snapshot written. */
  total: number;
  /** The partial line currently on screen (after the last newline). */
  partial: string;
}

export interface Snapshot {
  lines: readonly string[];
  totalLines: number;
  partial: string;
}

export interface TerminalUpdate {
  /** Clear the terminal before writing `text`. */
  reset: boolean;
  text: string;
}

const CRLF = '\r\n';

function fullText(next: Snapshot): string {
  return next.lines.map((line) => line + CRLF).join('') + next.partial;
}

// eslint-disable-next-line no-control-regex -- matching terminal control codes is the point
const INVISIBLE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * How many rows below the open line's first row the cursor sits after writing it. Each `\r`
 * returns to column 0 of the *current* row, so a progress line ("10%\r20%\r…") stays on one
 * row however long the text gets; only a segment wider than the terminal wraps down. Escape
 * sequences and other control codes take no columns. (Wide characters such as emoji count as
 * one column, and cursor-moving escape codes are not followed.)
 */
export function cursorRowOffset(text: string, cols: number): number {
  const width = Math.max(1, cols);
  let rows = 0;
  for (const segment of text.split('\r')) {
    const visible = segment.replace(INVISIBLE, '').length;
    // Exactly `width` characters leave the cursor on the same row (pending wrap).
    if (visible > 0) rows += Math.ceil(visible / width) - 1;
  }
  return rows;
}

export function terminalUpdate(shown: Shown, next: Snapshot, cols: number): TerminalUpdate {
  const added = next.totalLines - shown.total;
  // Cleared, or more lines arrived than the buffer holds (e.g. resuming after a long pause):
  // the terminal cannot be patched, redraw what the buffer has.
  if (added < 0 || added > next.lines.length) return { reset: true, text: fullText(next) };
  if (added === 0) {
    if (next.partial === shown.partial) return { reset: false, text: '' };
    // The common `Serial.print` case: the open line only grew.
    if (next.partial.startsWith(shown.partial)) {
      return { reset: false, text: next.partial.slice(shown.partial.length) };
    }
  }
  let text = '';
  if (shown.partial !== '') {
    // Back to the start of the open line (it may wrap over several rows) and erase it; the
    // completed version of that line is part of the new lines below.
    const up = cursorRowOffset(shown.partial, cols);
    text += `\r${up > 0 ? `\x1b[${up}A` : ''}\x1b[J`;
  }
  for (const line of next.lines.slice(next.lines.length - added)) text += line + CRLF;
  return { reset: false, text: text + next.partial };
}
