import { vi } from 'vitest';

// A fake device relay behind a `fetch` mock, for RelayTransport / RelayOtaFlasher tests.
// Routes follow server/relay/src/app.ts (protocol v1). Each `GET …/events` opens a stream the
// test drives by hand (`push`, `comment`, `end`, `fail`), so drops, heartbeats and
// reconnects with Last-Event-ID are deterministic.

export const DEVICE = 'fa4e00c3c3c3';
export const TOKEN = 'ab'.repeat(32);
export const RELAY = 'http://relay.test';
export const PAIRING = { deviceId: DEVICE, token: TOKEN, name: 'placa-azul', relayUrl: RELAY };

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export class FakeSseStream {
  readonly lastEventId: string | undefined;
  closed = false;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly body: ReadableStream<Uint8Array>;
  private readonly encoder = new TextEncoder();

  constructor(lastEventId: string | undefined, signal: AbortSignal | undefined) {
    this.lastEventId = lastEventId;
    this.body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });
    signal?.addEventListener('abort', () => this.fail(new DOMException('aborted', 'AbortError')), {
      once: true,
    });
  }

  raw(text: string): void {
    if (this.closed) return;
    this.controller.enqueue(this.encoder.encode(text));
  }

  push(event: string, data: unknown, id?: number): void {
    this.raw(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n${id === undefined ? '' : `id: ${id}\n`}\n`,
    );
  }

  comment(): void {
    this.raw(': ping\n\n');
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.close();
  }

  fail(error: unknown = new TypeError('network error')): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.error(error);
  }
}

type Handler = (req: RecordedRequest) => Response | Promise<Response> | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeRelay {
  readonly requests: RecordedRequest[] = [];
  readonly streams: FakeSseStream[] = [];
  /** Presence `GET /v1/devices/{id}` reports (null → 404 unknown_device). */
  device: { online: boolean; name: string } | null = { online: true, name: 'placa-azul' };
  /** Status of the next `GET …/events` (200 opens a stream). */
  eventsStatus = 200;
  /** Builds the relay knows, by id (absent → 404 unknown_build). */
  readonly builds = new Map<string, { state: string; detail?: string }>();
  /** The next `POST …/builds` answer: a build id (201) or a status code. */
  nextBuild: string[] = [];
  buildStatus = 201;
  inputStatus = 204;
  /** Per-test override; return undefined to fall through to the defaults. */
  handler: Handler | undefined;

  readonly fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body =
      init.body instanceof Uint8Array
        ? init.body
        : typeof init.body === 'string'
          ? new TextEncoder().encode(init.body)
          : undefined;
    const req: RecordedRequest = {
      method: init.method ?? 'GET',
      path: url.pathname,
      headers,
      ...(body ? { body } : {}),
    };
    this.requests.push(req);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const custom = await this.handler?.(req);
    if (custom) return custom;
    if (headers.authorization !== `Bearer ${TOKEN}`) return json({ error: 'unauthorized' }, 401);

    const base = `/v1/devices/${DEVICE}`;
    if (req.method === 'GET' && req.path === `${base}/events`) {
      if (this.eventsStatus !== 200) return json({ error: 'unknown_device' }, this.eventsStatus);
      const stream = new FakeSseStream(headers['last-event-id'], init.signal ?? undefined);
      this.streams.push(stream);
      return new Response(stream.body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (req.method === 'GET' && req.path === base) {
      if (!this.device) return json({ error: 'unknown_device' }, 404);
      return json({ ...this.device, lastSeen: 0, fw: 'fake' });
    }
    if (req.method === 'POST' && req.path === `${base}/builds`) {
      if (this.buildStatus !== 201) return json({ error: 'nope' }, this.buildStatus);
      const buildId = this.nextBuild.shift() ?? `build-${this.requests.length}`;
      this.builds.set(buildId, { state: 'queued' });
      return json({ buildId }, 201);
    }
    if (req.method === 'POST' && req.path === `${base}/input`) {
      return new Response(null, { status: this.inputStatus });
    }
    const build = /^\/v1\/builds\/([^/]+)$/.exec(req.path);
    if (req.method === 'GET' && build?.[1]) {
      const record = this.builds.get(build[1]);
      return record ? json(record) : json({ error: 'unknown_build' }, 404);
    }
    return json({ error: 'not_found' }, 404);
  });

  /** The latest event stream (the one a follower is reading now). */
  get stream(): FakeSseStream {
    const stream = this.streams[this.streams.length - 1];
    if (!stream) throw new Error('no event stream opened yet');
    return stream;
  }

  inputs(): string[] {
    return this.requests
      .filter((r) => r.method === 'POST' && r.path.endsWith('/input'))
      .map((r) => (JSON.parse(new TextDecoder().decode(r.body)) as { line: string }).line);
  }

  /** Replaces `fetch` (setup.ts leaves it pending forever); returns the undo. */
  install(): () => void {
    const previous = globalThis.fetch;
    globalThis.fetch = this.fetch as typeof fetch;
    return () => {
      globalThis.fetch = previous;
    };
  }
}

/** Lets pending promises and stream reads run (a few macrotask turns). */
export async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
