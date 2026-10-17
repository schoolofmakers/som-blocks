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

/** Rows a partial line takes on a terminal `cols` wide (control characters ignored). */
function rowsOf(text: string, cols: number): number {
  return Math.max(1, Math.ceil(text.length / Math.max(1, cols)));
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
    const up = rowsOf(shown.partial, cols) - 1;
    text += `\r${up > 0 ? `\x1b[${up}A` : ''}\x1b[J`;
  }
  for (const line of next.lines.slice(next.lines.length - added)) text += line + CRLF;
  return { reset: false, text: text + next.partial };
}
