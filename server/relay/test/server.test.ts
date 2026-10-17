// Real listening server: client disconnects and slow downloads behave as they do on Fly.
import { serve, type ServerType } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRelay, type Relay } from '../src/app.js';
import { DEV, TOKEN, auth, sha256 } from './helpers.js';

let relay: Relay;
let server: ServerType;
let base: string;

async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  relay = createRelay();
  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: relay.app.fetch, port: 0, hostname: '127.0.0.1' },
      (info: AddressInfo) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      },
    );
  });
  const res = await fetch(`${base}/v1/devices/${DEV}/register`, {
    method: 'POST',
    headers: { ...auth(TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fw: 'x', name: 'y', chip: 'esp32c3' }),
  });
  expect(res.status).toBe(204);
});

afterEach(async () => {
  relay.hub.closeAll();
  (server as import('node:http').Server).closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('over a real socket', () => {
  it('a long-poll whose client disconnects leaves no waiter behind', async () => {
    const ac = new AbortController();
    const poll = fetch(`${base}/v1/devices/${DEV}/next?wait=25`, {
      headers: auth(TOKEN),
      signal: ac.signal,
    }).catch(() => null);
    await until(() => relay.hub.counts().waiters === 1);
    ac.abort();
    await poll;
    await until(() => relay.hub.counts().waiters === 0);
  });

  it('an SSE client that disconnects is unsubscribed', async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}/v1/devices/${DEV}/events`, {
      headers: auth(TOKEN),
      signal: ac.signal,
    });
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: online');
    expect(relay.hub.counts().subscribers).toBe(1);
    ac.abort();
    await until(() => relay.hub.counts().subscribers === 0);
  });

  it('a stalled image download does not block other devices', async () => {
    const img = new Uint8Array(2 * 1024 * 1024).map((_, i) => i & 0xff);
    const created = await fetch(`${base}/v1/devices/${DEV}/builds`, {
      method: 'POST',
      headers: {
        ...auth(TOKEN),
        'Content-Type': 'application/octet-stream',
        'X-Image-Sha256': sha256(img),
      },
      body: img,
    });
    expect(created.status).toBe(201);
    const { buildId } = (await created.json()) as { buildId: string };

    // Open the download and never read the body: the socket stays full.
    const stalled = await fetch(`${base}/v1/builds/${buildId}/image`, { headers: auth(TOKEN) });
    expect(stalled.headers.get('content-length')).toBe(String(img.length));

    const t0 = Date.now();
    const other = await fetch(`${base}/v1/devices/${DEV}`, { headers: auth(TOKEN) });
    expect(other.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(500);

    // And the stalled one still completes intact once read.
    const bytes = new Uint8Array(await stalled.arrayBuffer());
    expect(sha256(bytes)).toBe(sha256(img));
  });
});
