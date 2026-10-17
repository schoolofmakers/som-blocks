import { createHash } from 'node:crypto';
import { createRelay, type RelayOptions } from '../src/app.js';
import type { RelayConfig } from '../src/config.js';

export const DEV = 'a0b1c2d3e4f5';
export const TOKEN = 'a1'.repeat(32);
export const TOKEN2 = 'b2'.repeat(32);
export const WRONG = 'c3'.repeat(32);

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `Response` whose `json()` is loosely typed: tests assert on the shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };

/** A relay with a hand-driven clock. */
export function setup(config: Partial<RelayConfig> = {}, extra: Omit<RelayOptions, 'now'> = {}) {
  let t = 1_800_000_000_000;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
  const relay = createRelay({ ...extra, config, now: clock.now });
  const req = async (path: string, init?: RequestInit) =>
    (await relay.app.request(path, init)) as TestResponse;

  const register = (token = TOKEN, body: Record<string, unknown> = {}, id = DEV) =>
    req(`/v1/devices/${id}/register`, {
      method: 'POST',
      headers: { ...auth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fw: 'resident-0.1', name: 'placa-1', chip: 'esp32c3', ...body }),
    });

  const pushBuild = (image: Uint8Array, token = TOKEN, sha = sha256(image), id = DEV) =>
    req(`/v1/devices/${id}/builds`, {
      method: 'POST',
      headers: {
        ...auth(token),
        'Content-Type': 'application/octet-stream',
        'X-Image-Sha256': sha,
      },
      body: image,
    });

  const postJson = (path: string, body: unknown, token = TOKEN) =>
    req(path, {
      method: 'POST',
      headers: { ...auth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const get = (path: string, token = TOKEN, init: RequestInit = {}) =>
    req(path, { ...init, headers: { ...auth(token), ...(init.headers ?? {}) } });

  return { relay, clock, req, register, pushBuild, postJson, get };
}

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/** Parses an SSE response body into events; comment lines (`: ping`) are reported as `comment`. */
export function sseReader(res: Pick<Response, 'body'>) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const queue: SseEvent[] = [];

  const parse = () => {
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev: SseEvent = { event: 'message', data: '' };
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) ev.event = 'comment';
        else if (line.startsWith('event: ')) ev.event = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
        else if (line.startsWith('id: ')) ev.id = line.slice(4);
      }
      ev.data = data.join('\n');
      queue.push(ev);
    }
  };

  return {
    async next(): Promise<SseEvent> {
      while (queue.length === 0) {
        const { done, value } = await reader.read();
        if (done) throw new Error('stream ended');
        buf += decoder.decode(value, { stream: true });
        parse();
      }
      return queue.shift()!;
    },
    async ended(): Promise<boolean> {
      for (;;) {
        const { done } = await reader.read();
        if (done) return true;
      }
    },
    cancel: () => reader.cancel(),
  };
}
