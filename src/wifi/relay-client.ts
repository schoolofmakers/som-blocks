// HTTP + SSE client for the device relay, editor side (protocol v1:
// _config/architecture.md → Track D → "Relay service"; behaviour notes: server/relay/README.md).
//
// The event stream needs `Authorization: Bearer`, which `EventSource` cannot send, so it is
// read with `fetch()` and a stream reader. Pattern: anthropics/anthropic-sdk-typescript
// src/core/streaming.ts (MIT) — bytes → lines → `SSEDecoder` (blank line ends an event,
// `:` lines are comments, `field: value` with one optional space). Reconnection follows
// vercel/ai packages/google/src/interactions/stream-google-interactions.ts (Apache-2.0):
// reopen with the last event id after an unexpected end, count attempts, back off.
// Differences: our ids are the relay's serial sequence numbers, so duplicates are dropped
// per line, not per event; an idle watchdog reopens a connection a proxy silently dropped
// (the relay sends a heartbeat comment every 15 s, so 45 s of silence means it is dead);
// backoff is exponential up to 30 s and never gives up (a classroom board comes back); and
// a 401 is final (the board rotated its token: re-pair), a 404 is "board not registered".
//
// Tokens: only ever in the Authorization header. Never in a URL, an error text or a log.

import type { WifiPairing } from './pairing';

export type RelayEndpoint = Pick<WifiPairing, 'relayUrl' | 'deviceId' | 'token'>;

export type BuildState = 'queued' | 'downloading' | 'flashing' | 'rebooting' | 'running' | 'failed';
export const TERMINAL_STATES: readonly BuildState[] = ['running', 'failed'];
const BUILD_STATES: readonly string[] = [
  'queued',
  'downloading',
  'flashing',
  'rebooting',
  'running',
  'failed',
];

export type RelayEvent =
  | { type: 'online' }
  | { type: 'offline' }
  | { type: 'status'; buildId: string; state: BuildState; detail?: string }
  | { type: 'serial'; lines: string[] };

/** Why a relay call failed; never carries the token. */
export type RelayErrorCode =
  | 'unauthorized'
  | 'unknown-device'
  | 'unknown-build'
  | 'too-large'
  | 'rate-limited'
  | 'busy'
  | 'bad-response'
  | 'network';

export class RelayError extends Error {
  readonly code: RelayErrorCode;
  readonly status?: number;
  readonly retryAfterSec?: number;

  constructor(code: RelayErrorCode, detail: string, status?: number, retryAfterSec?: number) {
    super(detail);
    this.name = 'RelayError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

function base(endpoint: RelayEndpoint): string {
  return endpoint.relayUrl.trim().replace(/\/+$/, '');
}

export function deviceUrl(endpoint: RelayEndpoint, path = ''): string {
  return `${base(endpoint)}/v1/devices/${endpoint.deviceId}${path}`;
}

function authHeaders(endpoint: RelayEndpoint, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${endpoint.token}`, ...extra };
}

function retryAfter(res: Response): number | undefined {
  const value = Number(res.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Maps a relay error reply (`{ error }`) to a RelayError. Reads nothing sensitive. */
async function errorFrom(res: Response, what: string): Promise<RelayError> {
  let code = '';
  try {
    code = String(((await res.json()) as { error?: unknown }).error ?? '');
  } catch {
    // Not JSON (a proxy page): the status says enough.
  }
  const detail = `${what}: HTTP ${res.status}${code ? ` ${code}` : ''}`;
  if (res.status === 401) return new RelayError('unauthorized', detail, 401);
  if (res.status === 404 && code === 'unknown_build')
    return new RelayError('unknown-build', detail, 404);
  if (res.status === 404) return new RelayError('unknown-device', detail, 404);
  if (res.status === 413) return new RelayError('too-large', detail, 413);
  if (res.status === 429) return new RelayError('rate-limited', detail, 429, retryAfter(res));
  if (res.status === 503) return new RelayError('busy', detail, 503, retryAfter(res));
  return new RelayError('bad-response', detail, res.status);
}

async function send(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    // fetch says only "Failed to fetch" (DNS, refused, CORS, offline); no URL with secrets.
    const text = error instanceof Error ? error.message : String(error);
    throw new RelayError('network', `${what}: ${text}`);
  }
}

/** `GET /v1/devices/{id}` → presence and name. */
export async function getDevice(
  endpoint: RelayEndpoint,
  signal?: AbortSignal,
): Promise<{ online: boolean; name?: string }> {
  const res = await send(deviceUrl(endpoint), { headers: authHeaders(endpoint), signal }, 'device');
  if (!res.ok) throw await errorFrom(res, 'device');
  const body = (await res.json()) as { online?: unknown; name?: unknown };
  return {
    online: body.online === true,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
  };
}

/** `GET /v1/builds/{buildId}` → its state, or RelayError 'unknown-build' once expired/lost. */
export async function getBuild(
  endpoint: RelayEndpoint,
  buildId: string,
  signal?: AbortSignal,
): Promise<{ state: BuildState; detail?: string }> {
  const res = await send(
    `${base(endpoint)}/v1/builds/${encodeURIComponent(buildId)}`,
    { headers: authHeaders(endpoint), signal },
    'build',
  );
  if (!res.ok) {
    const error = await errorFrom(res, 'build');
    // A build 404 is always "unknown build" (the device may still exist).
    throw error.status === 404 ? new RelayError('unknown-build', error.message, 404) : error;
  }
  const body = (await res.json()) as { state?: unknown; detail?: unknown };
  if (typeof body.state !== 'string' || !BUILD_STATES.includes(body.state)) {
    throw new RelayError('bad-response', 'build: unexpected state');
  }
  return {
    state: body.state as BuildState,
    ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
  };
}

/** `POST /v1/devices/{id}/builds` with the raw app image → the new build's id. */
export async function postBuild(
  endpoint: RelayEndpoint,
  image: Uint8Array,
  sha256: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await send(
    deviceUrl(endpoint, '/builds'),
    {
      method: 'POST',
      headers: authHeaders(endpoint, {
        'Content-Type': 'application/octet-stream',
        'X-Image-Sha256': sha256,
      }),
      // A copy in its own ArrayBuffer: the image may be a view into a larger buffer.
      body: image.slice(),
      signal,
    },
    'upload',
  );
  if (res.status !== 201) throw await errorFrom(res, 'upload');
  const body = (await res.json()) as { buildId?: unknown };
  if (typeof body.buildId !== 'string') throw new RelayError('bad-response', 'upload: no buildId');
  return body.buildId;
}

/** `POST /v1/devices/{id}/input` `{ line }` (one line the student typed). */
export async function postInput(
  endpoint: RelayEndpoint,
  line: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send(
    deviceUrl(endpoint, '/input'),
    {
      method: 'POST',
      headers: authHeaders(endpoint, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ line }),
      signal,
    },
    'input',
  );
  if (res.status !== 204 && !res.ok) throw await errorFrom(res, 'input');
}

/** One server-sent event as it came off the wire. */
export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental SSE parser: feed it text as it arrives, get complete events back. Comments
 * (`: ping`) produce nothing but still count as traffic for the caller's idle watchdog.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;

  push(text: string): SseMessage[] {
    this.buffer += text;
    const out: SseMessage[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, newline);
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
      // A lone '\r' at the very end may be the first half of '\r\n': wait for more.
      if (width === 1 && this.buffer[newline] === '\r' && newline === this.buffer.length - 1) {
        break;
      }
      this.buffer = this.buffer.slice(newline + width);
      const message = this.line(line);
      if (message) out.push(message);
    }
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === '') {
      if (this.data.length === 0 && this.event === '') return null;
      const message: SseMessage = {
        event: this.event || 'message',
        data: this.data.join('\n'),
        ...(this.id !== undefined ? { id: this.id } : {}),
      };
      this.event = '';
      this.data = [];
      this.id = undefined;
      return message;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id') this.id = value;
    return null;
  }
}

/** Where a follower resumes: the relay's serial sequence number of the last line we have. */
export interface EventCursor {
  lastSerialId?: number;
}

export interface FollowHooks {
  onEvent(event: RelayEvent): void;
  /** Every time the stream (re)opens with HTTP 200, `first` only for the first one. */
  onOpen?(first: boolean): void;
  /** The relay does not know the device (404 unknown_device): the board is not registered. */
  onUnknownDevice?(): void;
  /** A failure that retrying will not fix (401: the token is no longer this board's). */
  onFatal(error: RelayError): void;
}

export const followTiming = {
  /** First reconnect delay; doubles up to `maxBackoffMs`. */
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  /** No byte at all (not even the 15 s heartbeat) for this long: the connection is dead. */
  idleMs: 45_000,
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function toRelayEvent(message: SseMessage): RelayEvent | null {
  if (message.event === 'online' || message.event === 'offline') return { type: message.event };
  let data: unknown;
  try {
    data = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (message.event === 'status') {
    if (typeof d.buildId !== 'string' || typeof d.state !== 'string') return null;
    if (!BUILD_STATES.includes(d.state)) return null;
    return {
      type: 'status',
      buildId: d.buildId,
      state: d.state as BuildState,
      ...(typeof d.detail === 'string' ? { detail: d.detail } : {}),
    };
  }
  if (message.event === 'serial') {
    if (!Array.isArray(d.lines) || !d.lines.every((l) => typeof l === 'string')) return null;
    return { type: 'serial', lines: d.lines as string[] };
  }
  return null;
}

/**
 * Drops lines already delivered. A `serial` event's id is the sequence number of its last
 * line, so its lines are `id - n + 1 … id`. An id below the cursor means the relay restarted
 * (sequence numbers start at 1 again): everything is new. An id equal to it is a repeat.
 */
export function freshLines(lines: string[], id: number | undefined, cursor: EventCursor) {
  if (id === undefined || cursor.lastSerialId === undefined) {
    if (id !== undefined) cursor.lastSerialId = id;
    return lines;
  }
  if (id < cursor.lastSerialId) {
    cursor.lastSerialId = id;
    return lines;
  }
  const firstSeq = id - lines.length + 1;
  const skip = Math.max(0, cursor.lastSerialId - firstSeq + 1);
  cursor.lastSerialId = id;
  return lines.slice(skip);
}

/**
 * Follows `GET /v1/devices/{id}/events` until `signal` aborts or a fatal error: reconnects
 * with `Last-Event-ID` (exponential backoff ≤ 30 s) after any drop, and reopens a connection
 * that went silent. Resolves when it stops.
 */
export async function followEvents(
  endpoint: RelayEndpoint,
  hooks: FollowHooks,
  signal: AbortSignal,
  cursor: EventCursor = {},
): Promise<void> {
  let failures = 0;
  let first = true;
  while (!signal.aborted) {
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener('abort', stop, { once: true });
    let idle: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      clearTimeout(idle);
      idle = setTimeout(() => attempt.abort(), followTiming.idleMs);
    };
    let waitMs: number | undefined;
    try {
      kick();
      const headers: Record<string, string> = authHeaders(endpoint, {
        Accept: 'text/event-stream',
      });
      if (cursor.lastSerialId !== undefined) headers['Last-Event-ID'] = String(cursor.lastSerialId);
      const res = await fetch(deviceUrl(endpoint, '/events'), {
        headers,
        signal: attempt.signal,
        cache: 'no-store',
      });
      if (res.status === 401) {
        hooks.onFatal(await errorFrom(res, 'events'));
        return;
      }
      if (!res.ok) void res.body?.cancel().catch(() => undefined);
      if (res.status === 404) {
        // Not registered (relay restarted, record expired): its sequence numbers start over.
        cursor.lastSerialId = undefined;
        hooks.onUnknownDevice?.();
      } else if (res.status === 429) {
        waitMs = (retryAfter(res) ?? 5) * 1000;
      } else if (res.ok && res.body) {
        hooks.onOpen?.(first);
        first = false;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseParser();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            kick();
            const text = decoder.decode(value, { stream: true });
            for (const message of parser.push(text)) {
              const event = toRelayEvent(message);
              if (!event) continue;
              failures = 0;
              if (event.type === 'serial') {
                const id = message.id === undefined ? undefined : Number(message.id);
                const lines = freshLines(
                  event.lines,
                  Number.isInteger(id) ? id : undefined,
                  cursor,
                );
                if (lines.length > 0) hooks.onEvent({ type: 'serial', lines });
              } else {
                hooks.onEvent(event);
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch {
      // Network error, idle abort or our own close: reconnect unless we were stopped.
    } finally {
      clearTimeout(idle);
      signal.removeEventListener('abort', stop);
      attempt.abort();
    }
    if (signal.aborted) return;
    const backoff = Math.min(
      followTiming.baseBackoffMs * 2 ** Math.min(failures, 10),
      followTiming.maxBackoffMs,
    );
    failures += 1;
    await sleep(waitMs ?? backoff, signal);
  }
}
