// Requests that straddle a re-pairing, a DELETE or each other: whatever arrives late must not
// reach the record that replaced the one it was authorised against.
import { describe, expect, it } from 'vitest';
import { DEV, TOKEN, TOKEN2, auth, setup, sha256, sseReader } from './helpers.js';

const image = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

/** A request body the test feeds by hand, to hold an upload open across other calls. */
function heldBody() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
  return { stream, push: (b: Uint8Array) => ctrl.enqueue(b), end: () => ctrl.close() };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('late requests across re-pairing', () => {
  it('rotation ends old-token SSE streams and long-polls', async () => {
    const { register, get, relay } = setup();
    await register(TOKEN);
    const sse = sseReader(await get(`/v1/devices/${DEV}/events`, TOKEN));
    await sse.next();
    const poll = get(`/v1/devices/${DEV}/input?wait=25`, TOKEN);
    await tick();
    expect(relay.hub.counts()).toEqual({ waiters: 1, subscribers: 1 });
    expect((await register(TOKEN2, { previousToken: TOKEN })).status).toBe(204);
    expect((await poll).status).toBe(401);
    expect(await sse.ended()).toBe(true);
    expect(relay.hub.counts()).toEqual({ waiters: 0, subscribers: 0 });
  });

  it('an upload started before DELETE + re-pair is not queued for the new pairing', async () => {
    const { register, req, get, relay } = setup();
    await register(TOKEN);
    const img = image(1000);
    const body = heldBody();
    const upload = req(`/v1/devices/${DEV}/builds`, {
      method: 'POST',
      headers: {
        ...auth(TOKEN),
        'Content-Type': 'application/octet-stream',
        'X-Image-Sha256': sha256(img),
      },
      body: body.stream,
      duplex: 'half',
    } as RequestInit);
    body.push(img.subarray(0, 500));
    await tick();
    await req(`/v1/devices/${DEV}`, { method: 'DELETE', headers: auth(TOKEN) });
    await register(TOKEN2);
    body.push(img.subarray(500));
    body.end();
    expect((await upload).status).toBe(401);
    expect(relay.store.getDevice(DEV)?.pendingBuildId).toBeNull();
    expect((await get(`/v1/devices/${DEV}/next`, TOKEN2)).status).toBe(204);
  });

  it('a serial batch that lands after DELETE does not resurrect the record', async () => {
    const { register, req, relay } = setup();
    await register(TOKEN);
    const body = heldBody();
    const post = req(`/v1/devices/${DEV}/serial`, {
      method: 'POST',
      headers: { ...auth(TOKEN), 'Content-Type': 'application/json' },
      body: body.stream,
      duplex: 'half',
    } as RequestInit);
    await tick();
    await req(`/v1/devices/${DEV}`, { method: 'DELETE', headers: auth(TOKEN) });
    body.push(new TextEncoder().encode('{"lines":["tarde"]}'));
    body.end();
    expect((await post).status).toBe(404);
    expect(relay.store.getDevice(DEV)).toBeUndefined();
  });

  it('concurrent uploads reserve memory before reading, so the cap holds', async () => {
    const { register, req } = setup({ maxImageBytes: 2000, maxTotalImageBytes: 3000 });
    await register(TOKEN);
    const img = image(1500);
    const start = () => {
      const body = heldBody();
      const res = req(`/v1/devices/${DEV}/builds`, {
        method: 'POST',
        headers: {
          ...auth(TOKEN),
          'Content-Type': 'application/octet-stream',
          'X-Image-Sha256': sha256(img),
        },
        body: body.stream,
        duplex: 'half',
      } as RequestInit);
      return { body, res };
    };
    const a = start();
    await tick();
    const b = start();
    expect((await b.res).status).toBe(503);
    a.body.push(img);
    a.body.end();
    expect((await a.res).status).toBe(201);
    // Reservations are released: 1500 stored + a declared 1000 fits (a leaked 2000 would not).
    const small = image(1000, 3);
    const res = await req(`/v1/devices/${DEV}/builds`, {
      method: 'POST',
      headers: {
        ...auth(TOKEN),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(small.length),
        'X-Image-Sha256': sha256(small),
      },
      body: small,
    });
    expect(res.status).toBe(201);
  });

  it('terminal states are final; late status reports are acknowledged and ignored', async () => {
    const { register, pushBuild, get, postJson } = setup();
    await register();
    const first = (await (await pushBuild(image(100, 1))).json()).buildId;
    await pushBuild(image(100, 2)); // replaces `first` → failed/replaced
    const late = await postJson(`/v1/devices/${DEV}/status`, {
      buildId: first,
      state: 'downloading',
    });
    expect(late.status).toBe(204);
    expect(await (await get(`/v1/builds/${first}`)).json()).toEqual({
      state: 'failed',
      detail: 'replaced',
    });
  });
});

describe('slow SSE reader', () => {
  it('is dropped once its backlog overflows, without the client reading', async () => {
    const { register, get, postJson, relay } = setup({ sseMaxBacklog: 3 });
    await register();
    const res = await get(`/v1/devices/${DEV}/events`);
    expect(relay.hub.counts().subscribers).toBe(1);
    for (let i = 0; i < 20 && relay.hub.counts().subscribers > 0; i++) {
      await postJson(`/v1/devices/${DEV}/serial`, { lines: [`l${i}`] });
      await tick();
    }
    expect(relay.hub.counts().subscribers).toBe(0);
    // Closed, not left hanging: draining it now reaches the end.
    expect(await sseReader(res).ended()).toBe(true);
  });
});
