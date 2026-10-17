import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV, TOKEN, TOKEN2, WRONG, auth, setup, sha256, sseReader } from './helpers.js';

const image = (n = 4096, fill = 7) => new Uint8Array(n).fill(fill);

describe('auth and register', () => {
  it('401 without or with a wrong token', async () => {
    const { register, req, get } = setup();
    expect((await register()).status).toBe(204);
    expect((await req(`/v1/devices/${DEV}`)).status).toBe(401);
    expect((await get(`/v1/devices/${DEV}`, WRONG)).status).toBe(401);
    expect((await get(`/v1/devices/${DEV}`, 'short')).status).toBe(401);
    expect((await get(`/v1/devices/${DEV}`, TOKEN)).status).toBe(200);
  });

  it('accepts the same token again (reboot, reconnect)', async () => {
    const { register } = setup();
    expect((await register()).status).toBe(204);
    expect((await register()).status).toBe(204);
  });

  it('409 for a different token without previousToken, or with a wrong one', async () => {
    const { register, get } = setup();
    await register(TOKEN);
    expect((await register(TOKEN2)).status).toBe(409);
    expect((await register(TOKEN2, { previousToken: WRONG })).status).toBe(409);
    expect((await get(`/v1/devices/${DEV}`, TOKEN)).status).toBe(200);
  });

  it('rotates with a matching previousToken; the old token stops working', async () => {
    const { register, get } = setup();
    await register(TOKEN);
    expect((await register(TOKEN2, { previousToken: TOKEN })).status).toBe(204);
    expect((await get(`/v1/devices/${DEV}`, TOKEN)).status).toBe(401);
    expect((await get(`/v1/devices/${DEV}`, TOKEN2)).status).toBe(200);
  });

  it('stores only sha256(token)', async () => {
    const { register, relay } = setup();
    await register(TOKEN);
    const rec = relay.store.getDevice(DEV)!;
    expect(rec.tokenHash.toString('hex')).toBe(sha256(new TextEncoder().encode(TOKEN)));
    expect(JSON.stringify(rec)).not.toContain(TOKEN);
  });

  it('400 on a malformed device id; 404 for an unknown device', async () => {
    const { get } = setup();
    expect((await get('/v1/devices/AA:BB:CC')).status).toBe(400);
    expect((await get(`/v1/devices/${DEV}/next`)).status).toBe(404);
  });

  it('GET device reports online within 60 s of the last call', async () => {
    const { register, get, clock } = setup();
    await register();
    let body = await (await get(`/v1/devices/${DEV}`)).json();
    expect(body).toMatchObject({ online: true, fw: 'resident-0.1', name: 'placa-1' });
    clock.advance(61_000);
    body = await (await get(`/v1/devices/${DEV}`)).json();
    expect(body.online).toBe(false);
  });

  it('DELETE resets the record so a new token can register', async () => {
    const { register, req, get } = setup();
    await register(TOKEN);
    expect(
      (await req(`/v1/devices/${DEV}`, { method: 'DELETE', headers: auth(WRONG) })).status,
    ).toBe(401);
    expect(
      (await req(`/v1/devices/${DEV}`, { method: 'DELETE', headers: auth(TOKEN) })).status,
    ).toBe(204);
    expect((await get(`/v1/devices/${DEV}`, TOKEN)).status).toBe(404);
    expect((await register(TOKEN2)).status).toBe(204);
  });
});

describe('long-poll /next', () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }),
  );
  afterEach(() => vi.useRealTimers());

  it('answers 204 at the deadline', async () => {
    const { register, get, relay } = setup();
    await register();
    let status = 0;
    const p = get(`/v1/devices/${DEV}/next?wait=25`).then((r) => (status = r.status));
    await vi.advanceTimersByTimeAsync(24_900);
    expect(status).toBe(0);
    expect(relay.hub.counts().waiters).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(status).toBe(204);
    expect(relay.hub.counts().waiters).toBe(0);
  });

  it('clamps wait to 25 s and rejects junk', async () => {
    const { register, get } = setup();
    await register();
    let status = 0;
    const p = get(`/v1/devices/${DEV}/next?wait=600`).then((r) => (status = r.status));
    await vi.advanceTimersByTimeAsync(25_001);
    await p;
    expect(status).toBe(204);
    expect((await get(`/v1/devices/${DEV}/next?wait=abc`)).status).toBe(400);
  });

  it('answers 200 right away when a build is queued during the wait', async () => {
    const { register, get, pushBuild } = setup();
    await register();
    const img = image();
    const poll = get(`/v1/devices/${DEV}/next?wait=25`);
    await vi.advanceTimersByTimeAsync(3_000);
    const created = await pushBuild(img);
    expect(created.status).toBe(201);
    const { buildId } = await created.json();
    const res = await poll;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ buildId, size: img.length, sha256: sha256(img) });
  });

  it('a second poll from the same device supersedes the first (204)', async () => {
    const { register, get, relay } = setup();
    await register();
    const first = get(`/v1/devices/${DEV}/next?wait=25`);
    await vi.advanceTimersByTimeAsync(10);
    const second = get(`/v1/devices/${DEV}/next?wait=25`);
    expect((await first).status).toBe(204);
    expect(relay.hub.counts().waiters).toBe(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await second).status).toBe(204);
  });

  it('releases the waiter when the request is aborted', async () => {
    const { register, get, relay } = setup();
    await register();
    const ac = new AbortController();
    const p = get(`/v1/devices/${DEV}/next?wait=25`, TOKEN, { signal: ac.signal }).catch(
      () => null,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(relay.hub.counts().waiters).toBe(1);
    ac.abort();
    await p;
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.hub.counts().waiters).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('builds', () => {
  it('rejects a sha mismatch, a missing header and the wrong content type', async () => {
    const { register, pushBuild, req } = setup();
    await register();
    expect((await pushBuild(image(), TOKEN, 'f'.repeat(64))).status).toBe(400);
    expect(
      (
        await req(`/v1/devices/${DEV}/builds`, {
          method: 'POST',
          headers: { ...auth(TOKEN), 'Content-Type': 'application/octet-stream' },
          body: image(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req(`/v1/devices/${DEV}/builds`, {
          method: 'POST',
          headers: {
            ...auth(TOKEN),
            'Content-Type': 'text/plain',
            'X-Image-Sha256': sha256(image()),
          },
          body: image(),
        })
      ).status,
    ).toBe(415);
  });

  it('413 over 2 MB, declared or chunked', async () => {
    const { register, pushBuild, req } = setup();
    await register();
    const big = image(2 * 1024 * 1024 + 1);
    expect((await pushBuild(big)).status).toBe(413);
    // Chunked (no Content-Length): cancelled once the running total crosses the limit.
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent > 3 * 1024 * 1024) return ctrl.close();
        sent += 64 * 1024;
        ctrl.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const res = await req(`/v1/devices/${DEV}/builds`, {
      method: 'POST',
      headers: {
        ...auth(TOKEN),
        'Content-Type': 'application/octet-stream',
        'X-Image-Sha256': 'a'.repeat(64),
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(3 * 1024 * 1024);
  });

  it('one pending build per device: a new upload replaces a queued one', async () => {
    const { register, pushBuild, get } = setup();
    await register();
    const first = (await (await pushBuild(image(100, 1))).json()).buildId;
    const second = (await (await pushBuild(image(200, 2))).json()).buildId;
    expect(await (await get(`/v1/builds/${first}`)).json()).toEqual({
      state: 'failed',
      detail: 'replaced',
    });
    const next = await (await get(`/v1/devices/${DEV}/next`)).json();
    expect(next).toMatchObject({ buildId: second, size: 200 });
  });

  it('streams the image with Content-Length; status drives the build to a terminal state', async () => {
    const { register, pushBuild, get, postJson } = setup();
    await register();
    const img = image(50_000, 9);
    const { buildId } = await (await pushBuild(img)).json();
    expect(await (await get(`/v1/builds/${buildId}`)).json()).toEqual({ state: 'queued' });

    const dl = await get(`/v1/builds/${buildId}/image`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-length')).toBe('50000');
    expect(dl.headers.get('content-type')).toBe('application/octet-stream');
    expect(sha256(new Uint8Array(await dl.arrayBuffer()))).toBe(sha256(img));
    expect((await get(`/v1/builds/${buildId}/image`, WRONG)).status).toBe(401);

    for (const state of ['downloading', 'flashing', 'rebooting']) {
      expect((await postJson(`/v1/devices/${DEV}/status`, { buildId, state })).status).toBe(204);
      expect(await (await get(`/v1/builds/${buildId}`)).json()).toEqual({ state });
    }
    // Once the board took it, `next` no longer hands it out.
    expect((await get(`/v1/devices/${DEV}/next`)).status).toBe(204);
    expect(
      (await postJson(`/v1/devices/${DEV}/status`, { buildId, state: 'running' })).status,
    ).toBe(204);
    expect(await (await get(`/v1/builds/${buildId}`)).json()).toEqual({ state: 'running' });
    // Terminal: the image is freed.
    expect((await get(`/v1/builds/${buildId}/image`)).status).toBe(410);

    expect((await postJson(`/v1/devices/${DEV}/status`, { buildId, state: 'bogus' })).status).toBe(
      400,
    );
  });

  it('failed is terminal and keeps the detail', async () => {
    const { register, pushBuild, get, postJson } = setup();
    await register();
    const { buildId } = await (await pushBuild(image())).json();
    await postJson(`/v1/devices/${DEV}/status`, {
      buildId,
      state: 'failed',
      detail: 'sha mismatch',
    });
    expect(await (await get(`/v1/builds/${buildId}`)).json()).toEqual({
      state: 'failed',
      detail: 'sha mismatch',
    });
  });

  it('404 for a build after its 10 min TTL; the device forgets it too', async () => {
    const { register, pushBuild, get, relay, clock } = setup();
    await register();
    const { buildId } = await (await pushBuild(image())).json();
    clock.advance(9 * 60_000);
    relay.sweep();
    expect((await get(`/v1/builds/${buildId}`)).status).toBe(200);
    clock.advance(2 * 60_000);
    relay.sweep();
    expect((await get(`/v1/builds/${buildId}`)).status).toBe(404);
    await register();
    expect((await get(`/v1/devices/${DEV}/next`)).status).toBe(204);
  });

  it('another device’s token cannot read a build', async () => {
    const { register, pushBuild, get } = setup();
    await register(TOKEN);
    await register(TOKEN2, {}, 'ffffffffffff');
    const { buildId } = await (await pushBuild(image())).json();
    expect((await get(`/v1/builds/${buildId}`, TOKEN2)).status).toBe(401);
  });
});

describe('device TTL', () => {
  it('drops a device record after 24 h without calls', async () => {
    const { register, get, relay, clock } = setup();
    await register();
    clock.advance(23 * 3_600_000);
    relay.sweep();
    expect((await get(`/v1/devices/${DEV}`)).status).toBe(200);
    clock.advance(2 * 3_600_000);
    relay.sweep();
    expect((await get(`/v1/devices/${DEV}`)).status).toBe(404);
    // A wiped board can now register with a fresh token.
    expect((await register(TOKEN2)).status).toBe(204);
  });
});

describe('serial and input', () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }),
  );
  afterEach(() => vi.useRealTimers());

  it('serial batches: ≤ 50 lines, ≤ 8 kB, ring keeps the last 500 lines', async () => {
    const { register, postJson, relay } = setup();
    await register();
    expect((await postJson(`/v1/devices/${DEV}/serial`, { lines: ['hola'] })).status).toBe(204);
    const tooMany = Array.from({ length: 51 }, (_, i) => `l${i}`);
    expect((await postJson(`/v1/devices/${DEV}/serial`, { lines: tooMany })).status).toBe(400);
    expect(
      (await postJson(`/v1/devices/${DEV}/serial`, { lines: ['x'.repeat(9000)] })).status,
    ).toBe(413);
    for (let i = 0; i < 12; i++) {
      const lines = Array.from({ length: 50 }, (_, j) => `b${i}-${j}`);
      await postJson(`/v1/devices/${DEV}/serial`, { lines });
    }
    const ring = relay.store.serialSince(DEV, 0);
    expect(ring).toHaveLength(500);
    expect(ring.at(-1)?.line).toBe('b11-49');
  });

  it('input round trip: editor POST wakes the device long-poll', async () => {
    const { register, postJson, get } = setup();
    await register();
    const poll = get(`/v1/devices/${DEV}/input?wait=25`);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await postJson(`/v1/devices/${DEV}/input`, { line: 'encender' })).status).toBe(204);
    const res = await poll;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: ['encender'] });
    // Queued while no poll is open: delivered on the next poll right away.
    await postJson(`/v1/devices/${DEV}/input`, { line: 'a' });
    await postJson(`/v1/devices/${DEV}/input`, { line: 'b' });
    expect(await (await get(`/v1/devices/${DEV}/input?wait=25`)).json()).toEqual({
      lines: ['a', 'b'],
    });
    const empty = get(`/v1/devices/${DEV}/input?wait=2`);
    await vi.advanceTimersByTimeAsync(2_001);
    expect((await empty).status).toBe(204);
  });
});

describe('SSE events', () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }),
  );
  afterEach(() => vi.useRealTimers());

  it('delivers presence, status, serial, offline and online in order, with heartbeats', async () => {
    const { register, get, postJson, pushBuild, relay, clock } = setup();
    await register();
    const res = await get(`/v1/devices/${DEV}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const sse = sseReader(res);

    expect((await sse.next()).event).toBe('online');
    const { buildId } = await (await pushBuild(image())).json();
    let ev = await sse.next();
    expect(ev.event).toBe('status');
    expect(JSON.parse(ev.data)).toEqual({ buildId, state: 'queued' });

    await postJson(`/v1/devices/${DEV}/status`, { buildId, state: 'downloading' });
    await postJson(`/v1/devices/${DEV}/serial`, { lines: ['uno', 'dos'] });
    ev = await sse.next();
    expect([ev.event, JSON.parse(ev.data)]).toEqual(['status', { buildId, state: 'downloading' }]);
    ev = await sse.next();
    expect([ev.event, JSON.parse(ev.data), ev.id]).toEqual([
      'serial',
      { lines: ['uno', 'dos'] },
      '2',
    ]);

    await vi.advanceTimersByTimeAsync(15_000);
    expect((await sse.next()).event).toBe('comment');

    clock.advance(61_000);
    relay.sweep();
    expect((await sse.next()).event).toBe('offline');
    await register();
    expect((await sse.next()).event).toBe('online');

    await sse.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.hub.counts().subscribers).toBe(0);
  });

  it('replays missed serial lines after Last-Event-ID', async () => {
    const { register, get, postJson } = setup();
    await register();
    await postJson(`/v1/devices/${DEV}/serial`, { lines: ['a', 'b'] });
    await postJson(`/v1/devices/${DEV}/serial`, { lines: ['c'] });
    const sse = sseReader(
      await get(`/v1/devices/${DEV}/events`, TOKEN, { headers: { 'Last-Event-ID': '1' } }),
    );
    expect((await sse.next()).event).toBe('online');
    const ev = await sse.next();
    expect([ev.event, JSON.parse(ev.data), ev.id]).toEqual(['serial', { lines: ['b', 'c'] }, '3']);
    await sse.cancel();
  });

  it('DELETE ends the device’s SSE streams', async () => {
    const { register, get, req, relay } = setup();
    await register();
    const sse = sseReader(await get(`/v1/devices/${DEV}/events`));
    await sse.next();
    await req(`/v1/devices/${DEV}`, { method: 'DELETE', headers: auth(TOKEN) });
    expect(await sse.ended()).toBe(true);
    expect(relay.hub.counts().subscribers).toBe(0);
  });
});

describe('rate limits', () => {
  it('control calls: 60/min then 429 with Retry-After', async () => {
    const { register, get, clock } = setup();
    await register(); // 1
    for (let i = 0; i < 59; i++) expect((await get(`/v1/devices/${DEV}/next`)).status).toBe(204);
    const res = await get(`/v1/devices/${DEV}/next`);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    clock.advance(60_001);
    expect((await get(`/v1/devices/${DEV}/next`)).status).toBe(204);
  });

  it('serial: 150/min', async () => {
    const { register, postJson } = setup();
    await register();
    for (let i = 0; i < 150; i++) {
      expect((await postJson(`/v1/devices/${DEV}/serial`, { lines: ['x'] })).status).toBe(204);
    }
    expect((await postJson(`/v1/devices/${DEV}/serial`, { lines: ['x'] })).status).toBe(429);
  });

  it('builds: 10/h', async () => {
    const { register, pushBuild } = setup();
    await register();
    for (let i = 0; i < 10; i++) expect((await pushBuild(image(10, i))).status).toBe(201);
    const res = await pushBuild(image(10, 99));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(3000);
  });

  it('wrong-token calls do not burn the device’s budget', async () => {
    const { register, get } = setup();
    await register();
    for (let i = 0; i < 100; i++) await get(`/v1/devices/${DEV}/next`, WRONG);
    for (let i = 0; i < 100; i++) await register(WRONG);
    expect((await get(`/v1/devices/${DEV}/next`)).status).toBe(204);
  });
});

describe('cors and health', () => {
  it('allows only configured origins and the protocol headers', async () => {
    const { req } = setup({ allowedOrigins: ['https://blocks.example'] });
    const pre = await req(`/v1/devices/${DEV}/builds`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://blocks.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,x-image-sha256',
      },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://blocks.example');
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-image-sha256',
    );
    const other = await req('/healthz', { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(await other.json()).toEqual({ ok: true });
  });

  it('never logs tokens', async () => {
    const lines: string[] = [];
    const logger = {
      info: (m: string, f?: object) => lines.push(JSON.stringify({ m, ...f })),
      warn: (m: string, f?: object) => lines.push(JSON.stringify({ m, ...f })),
      error: (m: string, f?: object) => lines.push(JSON.stringify({ m, ...f })),
    };
    const { register, get } = setup({}, { logger });
    await register(TOKEN);
    await register(TOKEN2, { previousToken: TOKEN });
    await get(`/v1/devices/${DEV}`, TOKEN2);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).not.toContain(TOKEN);
      expect(l).not.toContain(TOKEN2);
    }
  });
});
