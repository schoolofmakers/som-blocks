// Turns the transport's raw byte chunks into text lines for the serial monitor and plotter.
//
// Pattern: duinoapp/duinoapp-client src/plugins/serial/base-serial.js keeps one decoded
// "message" stream next to the raw "data" one and drops data while an upload is muted (read as
// reference only; GPL, nothing copied). Differences: we decode with one *streaming*
// `TextDecoder` so a UTF-8 character split across two USB chunks (common: "ñ" is two bytes)
// is not turned into two replacement characters, we keep lines in a bounded ring instead of
// one growing string, and a line that never ends (binary garbage at the wrong baud) is cut
// at `maxLineLength` so memory stays bounded.

export const DEFAULT_MAX_LINES = 5000;
export const DEFAULT_MAX_LINE_LENGTH = 4096;

export interface LineAssemblerOptions {
  maxLines?: number;
  maxLineLength?: number;
}

/** A fixed-size ring of the most recent lines; the oldest line drops out first. */
export class LineRing {
  readonly capacity: number;
  private readonly items: string[];
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be ≥ 1');
    this.capacity = capacity;
    this.items = new Array<string>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(line: string): void {
    const index = (this.head + this.count) % this.capacity;
    this.items[index] = line;
    if (this.count < this.capacity) this.count += 1;
    else this.head = (this.head + 1) % this.capacity;
  }

  /** Oldest first. */
  toArray(): string[] {
    const out = new Array<string>(this.count);
    for (let i = 0; i < this.count; i += 1) {
      out[i] = this.items[(this.head + i) % this.capacity] ?? '';
    }
    return out;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.items.fill('');
  }
}

/**
 * Pure line assembler: feed it chunks, it emits complete lines (without `\n` or a trailing
 * `\r`) to its `onLine` subscribers and keeps the last `maxLines` of them. DOM-free.
 */
export class LineAssembler {
  readonly maxLineLength: number;
  private decoder = new TextDecoder('utf-8', { fatal: false });
  private readonly ring: LineRing;
  private pending = '';
  private total = 0;
  private readonly listeners = new Set<(line: string) => void>();

  constructor({
    maxLines = DEFAULT_MAX_LINES,
    maxLineLength = DEFAULT_MAX_LINE_LENGTH,
  }: LineAssemblerOptions = {}) {
    this.ring = new LineRing(maxLines);
    this.maxLineLength = maxLineLength;
  }

  /** The last complete lines, oldest first. */
  lines(): string[] {
    return this.ring.toArray();
  }

  /** Text received after the last newline (e.g. from `Serial.print` without `ln`). */
  get partial(): string {
    return this.pending;
  }

  /** How many lines were completed since the last `clear()`, including dropped ones. */
  get totalLines(): number {
    return this.total;
  }

  onLine(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Decodes one chunk; returns the lines it completed, in order. */
  push(chunk: Uint8Array): string[] {
    // `stream: true` holds back an incomplete UTF-8 sequence until the next chunk.
    return this.append(this.decoder.decode(chunk, { stream: true }));
  }

  /** Clears the buffer, the partial line and any half-received character. */
  clear(): void {
    this.decoder = new TextDecoder('utf-8', { fatal: false });
    this.ring.clear();
    this.pending = '';
    this.total = 0;
  }

  private append(text: string): string[] {
    const done: string[] = [];
    let start = 0;
    for (;;) {
      const newline = text.indexOf('\n', start);
      if (newline === -1) break;
      this.pending += text.slice(start, newline);
      this.complete(this.pending.endsWith('\r') ? this.pending.slice(0, -1) : this.pending, done);
      this.pending = '';
      start = newline + 1;
    }
    this.pending += text.slice(start);
    // A line that never ends (garbage at the wrong baud, a board printing without newlines)
    // is cut into pieces so neither the buffer nor the terminal row grows without bound.
    while (this.pending.length > this.maxLineLength) {
      this.complete(this.pending.slice(0, this.maxLineLength), done);
      this.pending = this.pending.slice(this.maxLineLength);
    }
    return done;
  }

  private complete(line: string, done: string[]): void {
    this.ring.push(line);
    this.total += 1;
    done.push(line);
    for (const cb of this.listeners) cb(line);
  }
}
