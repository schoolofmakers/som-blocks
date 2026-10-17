import { describe, expect, it, vi } from 'vitest';
import { LineAssembler, LineRing } from './stream';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('LineRing', () => {
  it('keeps the newest lines, oldest first', () => {
    const ring = new LineRing(3);
    for (const line of ['a', 'b', 'c', 'd', 'e']) ring.push(line);
    expect(ring.toArray()).toEqual(['c', 'd', 'e']);
    expect(ring.size).toBe(3);
    ring.clear();
    expect(ring.toArray()).toEqual([]);
  });

  it('rejects a useless capacity', () => {
    expect(() => new LineRing(0)).toThrow(RangeError);
  });
});

describe('LineAssembler', () => {
  it('splits on \\n, strips \\r and keeps the open line as partial', () => {
    const lines = new LineAssembler();
    expect(lines.push(bytes('hola\r\nmundo\nvalor:'))).toEqual(['hola', 'mundo']);
    expect(lines.partial).toBe('valor:');
    expect(lines.push(bytes('12\r\n'))).toEqual(['valor:12']);
    expect(lines.partial).toBe('');
    expect(lines.lines()).toEqual(['hola', 'mundo', 'valor:12']);
    expect(lines.totalLines).toBe(3);
  });

  it('joins a line split across chunks, including a \\r\\n split in half', () => {
    const lines = new LineAssembler();
    expect(lines.push(bytes('tem'))).toEqual([]);
    expect(lines.push(bytes('p:23\r'))).toEqual([]);
    expect(lines.push(bytes('\nhum:40\n'))).toEqual(['temp:23', 'hum:40']);
  });

  it('decodes a multi-byte character split across chunks', () => {
    const lines = new LineAssembler();
    const encoded = bytes('año 🌡\n');
    // "ñ" is 2 bytes (offsets 1-2) and the emoji 4 (offsets 5-8): cut inside both.
    expect(lines.push(encoded.slice(0, 2))).toEqual([]);
    expect(lines.push(encoded.slice(2, 7))).toEqual([]);
    expect(lines.push(encoded.slice(7))).toEqual(['año 🌡']);
  });

  it('never throws on binary garbage (wrong baud): replacement characters instead', () => {
    const lines = new LineAssembler();
    const garbage = new Uint8Array([0xff, 0xfe, 0xc3, 0x28, 0x80, 0x0a, 0xe2, 0x82]);
    expect(() => lines.push(garbage)).not.toThrow();
    expect(lines.lines()[0]).toContain('�');
  });

  it('cuts a line that never ends at maxLineLength', () => {
    const lines = new LineAssembler({ maxLineLength: 4 });
    expect(lines.push(bytes('abcdefghij'))).toEqual(['abcd', 'efgh']);
    expect(lines.partial).toBe('ij');
  });

  it('bounds the buffer but counts every line', () => {
    const lines = new LineAssembler({ maxLines: 2 });
    lines.push(bytes('1\n2\n3\n'));
    expect(lines.lines()).toEqual(['2', '3']);
    expect(lines.totalLines).toBe(3);
  });

  it('notifies onLine subscribers until they unsubscribe', () => {
    const lines = new LineAssembler();
    const cb = vi.fn();
    const off = lines.onLine(cb);
    lines.push(bytes('a\nb\n'));
    off();
    lines.push(bytes('c\n'));
    expect(cb.mock.calls).toEqual([['a'], ['b']]);
  });

  it('clear() forgets lines, the partial line and a half-received character', () => {
    const lines = new LineAssembler();
    lines.push(bytes('x\ny'));
    lines.push(new Uint8Array([0xc3])); // first byte of "ñ"
    lines.clear();
    expect(lines.lines()).toEqual([]);
    expect(lines.partial).toBe('');
    expect(lines.totalLines).toBe(0);
    expect(lines.push(bytes('ok\n'))).toEqual(['ok']);
  });
});
