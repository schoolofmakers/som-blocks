import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRelay, PAIRING, settle, TOKEN } from '../test/fake-relay';
import { followTiming } from '../wifi/relay-client';
import { MAX_INPUT_LINE, RelayTransport } from './relay';

describe('RelayTransport', () => {
  let relay: FakeRelay;
  let restore: () => void;
  let transport: RelayTransport;

  beforeEach(() => {
    relay = new FakeRelay();
    restore = relay.install();
    transport = new RelayTransport(PAIRING);
  });

  afterEach(async () => {
    await transport.close();
    restore();
    vi.useRealTimers();
  });

  it('is a relay transport that opens after checking the pairing', async () => {
    expect(transport.kind).toBe('relay');
    expect(transport.isOpen).toBe(false);
    await transport.open();
    expect(transport.isOpen).toBe(true);
    expect(transport.presence).toBe('online');
    await settle();
    expect(relay.streams).toHaveLength(1);
  });

  it('turns serial events into onData bytes, one line per line', async () => {
    const chunks: string[] = [];
    transport.onData((chunk) => chunks.push(new TextDecoder().decode(chunk)));
    await transport.open();
    await settle();
    relay.stream.push('serial', { lines: ['hola', 'ñandú 🌵'] }, 2);
    await settle();
    expect(chunks).toEqual(['hola\nñandú 🌵\n']);
  });

  it('follows online/offline and survives a drop without repeating lines', async () => {
    const presence: string[] = [];
    const chunks: string[] = [];
    transport.onPresence((p) => presence.push(p));
    transport.onData((chunk) => chunks.push(new TextDecoder().decode(chunk)));
    await transport.open();
    await settle();
    relay.stream.push('offline', { lastSeen: 1 });
    relay.stream.push('serial', { lines: ['a'] }, 1);
    await settle();
    relay.stream.fail();
    await new Promise((resolve) => setTimeout(resolve, followTiming.baseBackoffMs + 50));
    await settle();
    expect(relay.streams).toHaveLength(2);
    expect(relay.stream.lastEventId).toBe('1');
    relay.stream.push('online', { lastSeen: 2 });
    relay.stream.push('serial', { lines: ['a', 'b'] }, 2);
    await settle();
    expect(presence).toEqual(['online', 'offline', 'online']);
    expect(chunks.join('')).toBe('a\nb\n');
  });

  it('a reopen (after an upload) resumes from the last line it had', async () => {
    await transport.open();
    await settle();
    relay.stream.push('serial', { lines: ['x', 'y'] }, 8);
    await settle();
    await transport.close();
    expect(transport.isOpen).toBe(false);
    expect(relay.stream.closed).toBe(true);
    await transport.open();
    await settle();
    expect(relay.streams).toHaveLength(2);
    expect(relay.stream.lastEventId).toBe('8');
  });

  it('writes one POST /input per line, in order, without empty trailing lines', async () => {
    await transport.open();
    const encode = (text: string) => new TextEncoder().encode(text);
    await Promise.all([
      transport.write(encode('uno\r\n')),
      transport.write(encode('dos\ntres\n')),
      transport.write(encode('sin fin')),
    ]);
    expect(relay.inputs()).toEqual(['uno', 'dos', 'tres', 'sin fin']);
  });

  it('cuts a line longer than the relay accepts', async () => {
    await transport.open();
    await transport.write(new TextEncoder().encode(`${'a'.repeat(MAX_INPUT_LINE)}bb\n`));
    expect(relay.inputs()).toEqual(['a'.repeat(MAX_INPUT_LINE), 'bb']);
  });

  it('rejects writes when closed or refused, without the token in the error', async () => {
    await expect(transport.write(new Uint8Array([65]))).rejects.toMatchObject({ code: 'not-open' });
    await transport.open();
    relay.inputStatus = 500;
    const error = await transport.write(new TextEncoder().encode('x\n')).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'write-failed' });
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });

  it('opens a board the relay does not know as offline, and fails on a refused token', async () => {
    relay.device = null;
    await transport.open();
    expect(transport.presence).toBe('offline');
    await transport.close();
    const stranger = new RelayTransport({ ...PAIRING, token: 'cd'.repeat(32) });
    await expect(stranger.open()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(stranger.isOpen).toBe(false);
  });

  it('fails with unreachable when the relay cannot be reached', async () => {
    relay.handler = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(transport.open()).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('reports a disconnect when the relay stops accepting the token', async () => {
    const lost = vi.fn();
    transport.onDisconnect(lost);
    await transport.open();
    await settle();
    relay.handler = (req) =>
      req.path.endsWith('/events')
        ? new Response('{"error":"unauthorized"}', { status: 401 })
        : undefined;
    relay.stream.end();
    await new Promise((resolve) => setTimeout(resolve, followTiming.baseBackoffMs + 50));
    await settle();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(transport.isOpen).toBe(false);
  });
});
