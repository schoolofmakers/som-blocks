import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRelay, PAIRING, TOKEN } from '../test/fake-relay';
import {
  followEvents,
  followTiming,
  freshLines,
  getBuild,
  postBuild,
  postInput,
  RelayError,
  SseParser,
  type EventCursor,
  type RelayEvent,
} from './relay-client';

describe('SseParser', () => {
  it('parses events split across chunks, CRLF and comments', () => {
    const parser = new SseParser();
    expect(parser.push('event: serial\r\ndata: {"lines":')).toEqual([]);
    expect(parser.push('["a"]}\r\nid: 7\r')).toEqual([]);
    expect(parser.push('\n\r\n: ping\n\nevent: online\ndata: {}\n\n')).toEqual([
      { event: 'serial', data: '{"lines":["a"]}', id: '7' },
      { event: 'online', data: '{}' },
    ]);
  });

  it('joins multi-line data and defaults the event name', () => {
    expect(new SseParser().push('data: one\ndata:two\n\n')).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ]);
  });
});

describe('freshLines', () => {
  it('keeps everything the first time and remembers the id', () => {
    const cursor: EventCursor = {};
    expect(freshLines(['a', 'b'], 2, cursor)).toEqual(['a', 'b']);
    expect(cursor.lastSerialId).toBe(2);
  });

  it('drops lines already delivered when a replay overlaps', () => {
    const cursor: EventCursor = { lastSerialId: 5 };
    // Lines 4..7: 4 and 5 were seen.
    expect(freshLines(['4', '5', '6', '7'], 7, cursor)).toEqual(['6', '7']);
    expect(freshLines(['7'], 7, cursor)).toEqual([]);
  });

  it('treats a smaller id as a relay restart (sequence starts over)', () => {
    const cursor: EventCursor = { lastSerialId: 500 };
    expect(freshLines(['x'], 1, cursor)).toEqual(['x']);
    expect(cursor.lastSerialId).toBe(1);
  });
});

describe('relay calls', () => {
  let relay: FakeRelay;
  let restore: () => void;
  beforeEach(() => {
    relay = new FakeRelay();
    restore = relay.install();
  });
  afterEach(() => restore());

  it('sends the token only as a bearer header, never in the URL', async () => {
    await postInput(PAIRING, 'hola');
    const [req] = relay.requests;
    expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req?.path).not.toContain(TOKEN);
    expect(relay.inputs()).toEqual(['hola']);
  });

  it('posts a build as octet-stream with its sha256 header', async () => {
    relay.nextBuild = ['b1'];
    const id = await postBuild(PAIRING, new Uint8Array([1, 2, 3]), 'f'.repeat(64));
    expect(id).toBe('b1');
    const req = relay.requests.at(-1);
    expect(req?.headers['content-type']).toBe('application/octet-stream');
    expect(req?.headers['x-image-sha256']).toBe('f'.repeat(64));
    expect([...(req?.body ?? [])]).toEqual([1, 2, 3]);
  });

  it('maps relay errors without leaking the token', async () => {
    relay.buildStatus = 413;
    const error = await postBuild(PAIRING, new Uint8Array([1]), 'f'.repeat(64)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RelayError);
    expect(error).toMatchObject({ code: 'too-large', status: 413 });
    expect(String((error as Error).message)).not.toContain(TOKEN);
    await expect(getBuild(PAIRING, 'nope')).rejects.toMatchObject({ code: 'unknown-build' });
    relay.handler = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(postInput(PAIRING, 'x')).rejects.toMatchObject({ code: 'network' });
  });
});

describe('followEvents', () => {
  let relay: FakeRelay;
  let restore: () => void;
  let controller: AbortController;
  let events: RelayEvent[];
  let opens: boolean[];
  let fatal: RelayError[];
  let done: Promise<void>;
  const cursor: EventCursor = {};

  const start = (c: EventCursor = cursor) => {
    done = followEvents(
      PAIRING,
      {
        onEvent: (e) => events.push(e),
        onOpen: (first) => opens.push(first),
        onFatal: (e) => fatal.push(e),
      },
      controller.signal,
      c,
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    relay = new FakeRelay();
    restore = relay.install();
    controller = new AbortController();
    events = [];
    opens = [];
    fatal = [];
    delete cursor.lastSerialId;
  });

  afterEach(async () => {
    controller.abort();
    await vi.runOnlyPendingTimersAsync();
    await done;
    restore();
    vi.useRealTimers();
  });

  it('delivers presence, status and serial events', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.requests[0]?.headers.accept).toBe('text/event-stream');
    relay.stream.push('online', { lastSeen: 1 });
    relay.stream.push('status', { buildId: 'b', state: 'flashing' });
    relay.stream.push('serial', { lines: ['hola', 'mundo'] }, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([
      { type: 'online' },
      { type: 'status', buildId: 'b', state: 'flashing' },
      { type: 'serial', lines: ['hola', 'mundo'] },
    ]);
    expect(opens).toEqual([true]);
  });

  it('reconnects after a drop with Last-Event-ID and does not repeat lines', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    relay.stream.push('serial', { lines: ['l1', 'l2'] }, 2);
    await vi.advanceTimersByTimeAsync(0);
    relay.stream.fail();
    await vi.advanceTimersByTimeAsync(followTiming.baseBackoffMs);
    expect(relay.streams).toHaveLength(2);
    expect(relay.stream.lastEventId).toBe('2');
    // The relay replays from its ring; an overlap (line 2 again) is dropped here.
    relay.stream.push('serial', { lines: ['l2', 'l3'] }, 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([
      { type: 'serial', lines: ['l1', 'l2'] },
      { type: 'serial', lines: ['l3'] },
    ]);
    expect(opens).toEqual([true, false]);
  });

  it('survives a 30 s idle stretch kept alive by heartbeats', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      relay.stream.comment();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.streams).toHaveLength(1);
    relay.stream.push('serial', { lines: ['tarde'] }, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ type: 'serial', lines: ['tarde'] }]);
  });

  it('reopens a connection that went completely silent', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(followTiming.idleMs + followTiming.baseBackoffMs);
    expect(relay.streams).toHaveLength(2);
  });

  it('backs off exponentially, capped at 30 s, while the device is unknown', async () => {
    relay.eventsStatus = 404;
    const unknown = vi.fn();
    done = followEvents(
      PAIRING,
      { onEvent: () => {}, onUnknownDevice: unknown, onFatal: () => {} },
      controller.signal,
      { lastSerialId: 9 },
    );
    const times: number[] = [];
    let last = Date.now();
    relay.handler = () => {
      times.push(Date.now() - last);
      last = Date.now();
      return undefined;
    };
    await vi.advanceTimersByTimeAsync(200_000);
    // 1, 2, 4, 8, 16, 30, 30… seconds between attempts.
    expect(times.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(unknown).toHaveBeenCalled();
    // A device the relay forgot starts its sequence over: no stale Last-Event-ID.
    expect(relay.requests.at(-1)?.headers['last-event-id']).toBeUndefined();
  });

  it('stops for good on 401 (the board rotated its token)', async () => {
    relay.handler = (req) =>
      req.path.endsWith('/events')
        ? new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
        : undefined;
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(fatal).toHaveLength(1);
    expect(fatal[0]?.code).toBe('unauthorized');
    expect(relay.requests).toHaveLength(1);
  });
});
