// som-relay: protocol v1 from `_config/architecture.md` → "Track D" → "Relay service".
//
// Patterns adapted (not copied) from the corpus:
// - honojs/hono `src/helper/streaming/sse.ts`: `streamSSE` + `stream.onAbort` for the editor
//   event stream; the callback stays pending until the client goes away.
// - paperclipai/paperclip `server/src/routes/board-chat.ts`: SSE behind proxies sends
//   `X-Accel-Buffering: no` and writes an event immediately so headers flush.
// - honojs/hono middleware/body-limit: reject on `Content-Length` before reading, count
//   bytes on chunked bodies (our `readLimited` cancels the stream instead of buffering).

import { createHash, randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { bearerToken, hashToken, isWellFormedToken, tokenMatches } from './auth.js';
import { readLimited } from './body.js';
import { defaultConfig, type RelayConfig } from './config.js';
import { Hub } from './hub.js';
import { silentLogger, type Logger } from './log.js';
import { RateLimiter } from './rate-limit.js';
import { MemoryStore, type Store } from './store.js';
import {
  DEVICE_BUILD_STATES,
  TERMINAL_BUILD_STATES,
  type BuildRecord,
  type DeviceBuildState,
  type DeviceRecord,
  type RelayEvent,
} from './types.js';

export interface RelayOptions {
  config?: Partial<RelayConfig>;
  store?: Store;
  /** Injectable clock (ms since epoch) for TTL, presence and rate-limit tests. */
  now?: () => number;
  logger?: Logger;
}

/** deviceId = the chip's base MAC, lower-case hex without separators. */
const DEVICE_ID_RE = /^[0-9a-f]{12}$/;
const BUILD_ID_RE = /^[0-9a-f-]{36}$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const MAX_DEVICES = 10_000;
const IMAGE_CHUNK = 16 * 1024;
const MAX_FIELD = 64;
const MAX_DETAIL = 500;
/** How long a closing SSE stream may take to flush its queued events. */
const SSE_FLUSH_MS = 5_000;

type Bucket = keyof RelayConfig['limits'];

export function createRelay(opts: RelayOptions = {}) {
  const config: RelayConfig = { ...defaultConfig, ...opts.config };
  const now = opts.now ?? Date.now;
  const log = opts.logger ?? silentLogger;
  const store =
    opts.store ??
    new MemoryStore({
      serialRingLines: config.serialRingLines,
      inputQueueLines: config.inputQueueLines,
    });
  const hub = new Hub();
  /** Bytes reserved by uploads whose bodies are still being read. */
  let reservedImageBytes = 0;
  const limiter = new RateLimiter(now);
  const app = new Hono();

  // ---- helpers -------------------------------------------------------------------------

  const fail = (c: Context, status: 400 | 401 | 404 | 409 | 410 | 413 | 415, error: string) =>
    c.json({ error }, status);

  const rateLimit = (c: Context, deviceId: string, bucket: Bucket): Response | null => {
    const { limit, windowMs } = config.limits[bucket];
    const r = limiter.hit(`${deviceId}:${bucket}`, limit, windowMs);
    if (r.ok) return null;
    log.warn('rate limited', { deviceId, bucket });
    c.header('Retry-After', String(r.retryAfterSec));
    return c.json({ error: 'rate_limited' }, 429);
  };

  /**
   * Bearer token matching the stored hash of an existing device, or an error response.
   * Handlers call it again after every await (body read, long-poll wait): the record may have
   * been deleted, expired or re-paired with another token in the meantime, and nothing that
   * arrives late may be written to, or read from, the record that replaced it.
   */
  const authDevice = (c: Context): { device: DeviceRecord } | { res: Response } => {
    const id = c.req.param('id') ?? '';
    if (!DEVICE_ID_RE.test(id)) return { res: fail(c, 400, 'bad_device_id') };
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return { res: fail(c, 401, 'unauthorized') };
    const device = store.getDevice(id);
    // 404 tells a board its record is gone (relay restart, TTL, DELETE): re-register.
    if (!device) return { res: fail(c, 404, 'unknown_device') };
    if (!tokenMatches(device.tokenHash, token)) return { res: fail(c, 401, 'unauthorized') };
    return { device };
  };

  /** A build plus its device, authorised by the device's token. */
  const authBuild = (
    c: Context,
  ): { build: BuildRecord; device: DeviceRecord } | { res: Response } => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return { res: fail(c, 401, 'unauthorized') };
    const buildId = c.req.param('buildId') ?? '';
    const build = BUILD_ID_RE.test(buildId) ? store.getBuild(buildId) : undefined;
    const device = build && store.getDevice(build.deviceId);
    if (!build || !device) return { res: fail(c, 404, 'unknown_build') };
    if (!tokenMatches(device.tokenHash, token)) return { res: fail(c, 401, 'unauthorized') };
    return { build, device };
  };

  const readJson = async (
    c: Context,
    max: number,
  ): Promise<{ value: Record<string, unknown> } | { res: Response }> => {
    const body = await readLimited(c.req.raw, max);
    if (!body.ok) return { res: fail(c, 413, 'body_too_large') };
    try {
      const value: unknown = JSON.parse(body.bytes.toString('utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { value: value as Record<string, unknown> };
      }
    } catch {
      // fall through
    }
    return { res: fail(c, 400, 'bad_json') };
  };

  /** `?wait=` in whole seconds, clamped to `maxWaitSec`; missing = 0 (answer right away). */
  const parseWait = (c: Context): number | null => {
    const raw = c.req.query('wait');
    if (raw === undefined) return 0;
    if (!/^\d{1,4}$/.test(raw)) return null;
    return Math.min(Number(raw), config.maxWaitSec);
  };

  const touch = (device: DeviceRecord) => {
    device.lastSeen = now();
    if (!device.announcedOnline) {
      device.announcedOnline = true;
      hub.publish(device.id, { event: 'online', data: { lastSeen: device.lastSeen } });
    }
    store.putDevice(device);
  };

  const isOnline = (device: DeviceRecord) => now() - device.lastSeen <= config.onlineWindowMs;

  const setBuildState = (build: BuildRecord, state: BuildRecord['state'], detail?: string) => {
    build.state = state;
    build.detail = detail;
    build.updatedAt = now();
    if (TERMINAL_BUILD_STATES.includes(state)) build.image = null;
    store.putBuild(build);
    hub.publish(build.deviceId, {
      event: 'status',
      data: { buildId: build.id, state, ...(detail !== undefined && { detail }) },
    });
  };

  const forgetDevice = (deviceId: string) => {
    store.deleteDevice(deviceId);
    hub.closeDevice(deviceId);
    limiter.forget(`${deviceId}:`);
  };

  /**
   * Long-poll shared by `next` and `input`: answer now if there is something, else wait up to
   * `wait` seconds. The wait ends early on the request's abort signal (the client went away),
   * so a dropped board leaves no timer or listener behind.
   */
  const longPoll = async (
    c: Context,
    device: DeviceRecord,
    kind: 'build' | 'input',
    deliver: () => Response | null,
  ): Promise<Response> => {
    const wait = parseWait(c);
    if (wait === null) return fail(c, 400, 'bad_wait');
    const ready = deliver();
    if (ready) return ready;
    const outcome = await hub.wait(device.id, kind, wait * 1000, c.req.raw.signal);
    const again = authDevice(c);
    if ('res' in again) return again.res;
    if (outcome !== 'aborted') touch(again.device);
    return (outcome === 'woken' && deliver()) || c.body(null, 204);
  };

  // ---- middleware ----------------------------------------------------------------------

  app.use('*', async (c, next) => {
    const started = now();
    await next();
    if (c.req.path === '/healthz') return;
    // Never log headers or bodies: they carry bearer tokens and student output.
    log.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: now() - started,
    });
  });

  app.use(
    '*',
    cors({
      origin: config.allowedOrigins,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-Image-Sha256', 'Last-Event-ID'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    log.error('unhandled', { path: c.req.path, err: err.message });
    return c.json({ error: 'internal' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.get('/healthz', (c) => c.json({ ok: true }));

  // ---- device → relay ------------------------------------------------------------------

  app.post('/v1/devices/:id/register', async (c) => {
    const id = c.req.param('id');
    if (!DEVICE_ID_RE.test(id)) return fail(c, 400, 'bad_device_id');
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return fail(c, 401, 'unauthorized');
    const body = await readJson(c, config.maxJsonBodyBytes);
    if ('res' in body) return body.res;
    const { fw, name, chip, previousToken } = body.value;
    if (
      !isShortString(fw) ||
      !isShortString(name) ||
      !isShortString(chip) ||
      (previousToken !== undefined && !isWellFormedToken(previousToken))
    ) {
      return fail(c, 400, 'bad_register');
    }

    let device = store.getDevice(id);
    let rotate = false;
    if (!device) {
      if (store.listDevices().length >= MAX_DEVICES) {
        c.header('Retry-After', '60');
        return c.json({ error: 'full' }, 503);
      }
      device = {
        id,
        tokenHash: hashToken(token),
        fw,
        name,
        chip,
        createdAt: now(),
        lastSeen: now(),
        announcedOnline: false,
        pendingBuildId: null,
      };
      log.info('device created', { deviceId: id });
    } else if (tokenMatches(device.tokenHash, token)) {
      // Routine re-register (boot, WiFi reconnect, OTA reboot): always accepted.
    } else if (previousToken !== undefined && tokenMatches(device.tokenHash, previousToken)) {
      rotate = true;
    } else {
      // Online or not: knowing a MAC must not let anyone take over or lock out a board.
      return fail(c, 409, 'token_conflict');
    }

    const limited = rateLimit(c, id, 'control');
    if (limited) return limited;
    if (rotate) {
      device.tokenHash = hashToken(token);
      // Streams and polls opened with the old token end now; their handlers re-check the
      // token before answering, so the old token gets nothing more.
      hub.closeDevice(id);
      log.info('device token rotated', { deviceId: id });
    }
    device.fw = fw;
    device.name = name;
    device.chip = chip;
    touch(device);
    return c.body(null, 204);
  });

  app.get('/v1/devices/:id/next', async (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const { device } = auth;
    const limited = rateLimit(c, device.id, 'control');
    if (limited) return limited;
    touch(device);
    return longPoll(c, device, 'build', () => {
      const current = store.getDevice(device.id);
      const build = current?.pendingBuildId ? store.getBuild(current.pendingBuildId) : undefined;
      if (!build) return null;
      return c.json({ buildId: build.id, size: build.size, sha256: build.sha256 }, 200);
    });
  });

  app.get('/v1/builds/:buildId/image', (c) => {
    const auth = authBuild(c);
    if ('res' in auth) return auth.res;
    const { build, device } = auth;
    const image = build.image;
    if (!image) return fail(c, 410, 'image_gone');
    touch(device);
    // Pull-based stream: the next chunk is produced only when the socket drained the last
    // one, so a slow board holds a reference to its own image and nothing else.
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= image.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + IMAGE_CHUNK, image.length);
        controller.enqueue(new Uint8Array(image.buffer, image.byteOffset + offset, end - offset));
        offset = end;
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(image.length),
        'X-Image-Sha256': build.sha256,
        'Cache-Control': 'no-store',
      },
    });
  });

  app.post('/v1/devices/:id/status', async (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const limited = rateLimit(c, auth.device.id, 'control');
    if (limited) return limited;
    const body = await readJson(c, config.maxJsonBodyBytes);
    if ('res' in body) return body.res;
    const again = authDevice(c);
    if ('res' in again) return again.res;
    const device = again.device;
    const { buildId, state, detail } = body.value;
    if (
      typeof buildId !== 'string' ||
      !DEVICE_BUILD_STATES.includes(state as DeviceBuildState) ||
      (detail !== undefined && typeof detail !== 'string')
    ) {
      return fail(c, 400, 'bad_status');
    }
    const build = store.getBuild(buildId);
    if (!build || build.deviceId !== device.id) return fail(c, 404, 'unknown_build');
    if (device.pendingBuildId === build.id) device.pendingBuildId = null;
    touch(device);
    // Terminal states are final: a late or repeated report (e.g. `downloading` for a build
    // that was replaced meanwhile) is acknowledged and ignored, so a reconnecting editor
    // still reads the real outcome.
    if (!TERMINAL_BUILD_STATES.includes(build.state)) {
      setBuildState(build, state as DeviceBuildState, detail?.slice(0, MAX_DETAIL));
    }
    return c.body(null, 204);
  });

  app.post('/v1/devices/:id/serial', async (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const limited = rateLimit(c, auth.device.id, 'serial');
    if (limited) return limited;
    const body = await readJson(c, config.maxSerialBodyBytes);
    if ('res' in body) return body.res;
    const again = authDevice(c);
    if ('res' in again) return again.res;
    const device = again.device;
    const { lines } = body.value;
    if (
      !Array.isArray(lines) ||
      lines.length > config.maxSerialLines ||
      !lines.every((l): l is string => typeof l === 'string')
    ) {
      return fail(c, 400, 'bad_serial');
    }
    touch(device);
    if (lines.length > 0) {
      const seq = store.appendSerial(device.id, lines);
      hub.publish(device.id, { event: 'serial', data: { lines }, id: seq });
    }
    return c.body(null, 204);
  });

  app.get('/v1/devices/:id/input', async (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const { device } = auth;
    const limited = rateLimit(c, device.id, 'control');
    if (limited) return limited;
    touch(device);
    return longPoll(c, device, 'input', () => {
      const lines = store.drainInput(device.id);
      return lines.length > 0 ? c.json({ lines }, 200) : null;
    });
  });

  // ---- editor → relay ------------------------------------------------------------------

  app.get('/v1/devices/:id', (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const { device } = auth;
    return c.json({
      online: isOnline(device),
      lastSeen: device.lastSeen,
      fw: device.fw,
      name: device.name,
    });
  });

  app.delete('/v1/devices/:id', (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    forgetDevice(auth.device.id);
    log.info('device deleted', { deviceId: auth.device.id });
    return c.body(null, 204);
  });

  app.get('/v1/builds/:buildId', (c) => {
    const auth = authBuild(c);
    if ('res' in auth) return auth.res;
    const { state, detail } = auth.build;
    return c.json({ state, ...(detail !== undefined && { detail }) });
  });

  app.post('/v1/devices/:id/builds', async (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const { device } = auth;
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/octet-stream') return fail(c, 415, 'want_octet_stream');
    const expectedSha = c.req.header('x-image-sha256');
    if (!expectedSha || !SHA256_RE.test(expectedSha)) return fail(c, 400, 'bad_sha256_header');
    const limited = rateLimit(c, device.id, 'builds');
    if (limited) return limited;
    // Reserve memory for this upload before reading it, so concurrent uploads cannot each
    // pass the cap check and overshoot it together. Released on every exit path.
    const declared = Number(c.req.header('content-length'));
    const reserve =
      Number.isFinite(declared) && declared >= 0
        ? Math.min(declared, config.maxImageBytes)
        : config.maxImageBytes;
    if (store.imageBytes() + reservedImageBytes + reserve > config.maxTotalImageBytes) {
      log.warn('image memory full', { deviceId: device.id });
      c.header('Retry-After', '60');
      return c.json({ error: 'busy' }, 503);
    }
    reservedImageBytes += reserve;
    let body: Awaited<ReturnType<typeof readLimited>>;
    try {
      body = await readLimited(c.req.raw, Math.min(reserve, config.maxImageBytes));
    } finally {
      reservedImageBytes -= reserve;
    }
    if (!body.ok) return fail(c, 413, 'image_too_large');
    const image = body.bytes;
    if (image.length === 0) return fail(c, 400, 'empty_image');
    const sha256 = createHash('sha256').update(image).digest('hex');
    if (sha256 !== expectedSha.toLowerCase()) return fail(c, 400, 'sha256_mismatch');

    // The device may have been deleted or re-paired while the body was uploading.
    const again = authDevice(c);
    if ('res' in again) return again.res;
    const current = again.device;

    // One pending build per device: a newer upload replaces one the board has not started.
    const previous = current.pendingBuildId ? store.getBuild(current.pendingBuildId) : undefined;
    if (previous && previous.state === 'queued') setBuildState(previous, 'failed', 'replaced');

    const t = now();
    const build: BuildRecord = {
      id: randomUUID(),
      deviceId: current.id,
      image,
      size: image.length,
      sha256,
      state: 'queued',
      createdAt: t,
      updatedAt: t,
    };
    store.putBuild(build);
    current.pendingBuildId = build.id;
    store.putDevice(current);
    hub.publish(current.id, { event: 'status', data: { buildId: build.id, state: 'queued' } });
    hub.wake(current.id, 'build');
    log.info('build queued', { deviceId: current.id, buildId: build.id, size: build.size });
    return c.json({ buildId: build.id }, 201);
  });

  app.post('/v1/devices/:id/input', async (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const body = await readJson(c, config.maxJsonBodyBytes);
    if ('res' in body) return body.res;
    const again = authDevice(c);
    if ('res' in again) return again.res;
    const device = again.device;
    const { line } = body.value;
    if (typeof line !== 'string' || line.length > config.maxInputLineChars) {
      return fail(c, 400, 'bad_input');
    }
    store.pushInput(device.id, line);
    hub.wake(device.id, 'input');
    return c.body(null, 204);
  });

  app.get('/v1/devices/:id/events', (c) => {
    const auth = authDevice(c);
    if ('res' in auth) return auth.res;
    const { device } = auth;
    const lastEventId = Number(c.req.header('last-event-id'));
    // Proxies (nginx-style) must not buffer the stream.
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      let done!: () => void;
      const finished = new Promise<void>((resolve) => (done = resolve));
      let closed = false;
      let overflowed = false;
      let backlog = 0;
      let chain: Promise<unknown> = Promise.resolve();

      // Writes are chained so events reach the editor in publish order; a client that falls
      // `sseMaxBacklog` events behind is dropped instead of growing memory without bound.
      const enqueue = (write: () => Promise<unknown>) => {
        if (closed) return;
        if (++backlog > config.sseMaxBacklog) {
          log.warn('sse backlog exceeded', { deviceId: device.id });
          overflowed = true;
          done();
          return;
        }
        chain = chain
          .then(write)
          .catch(() => {})
          .finally(() => backlog--);
      };
      const send = (ev: RelayEvent) =>
        enqueue(() =>
          stream.writeSSE({
            event: ev.event,
            data: JSON.stringify(ev.data),
            ...('id' in ev && { id: String(ev.id) }),
          }),
        );

      // Current presence first: it also flushes the headers through any proxy.
      send({
        event: isOnline(device) ? 'online' : 'offline',
        data: { lastSeen: device.lastSeen },
      });
      // Reconnect after a drop: replay serial lines the editor missed (from the ring).
      if (Number.isInteger(lastEventId) && lastEventId >= 0) {
        const missed = store.serialSince(device.id, lastEventId);
        const last = missed[missed.length - 1];
        if (last)
          send({ event: 'serial', data: { lines: missed.map((l) => l.line) }, id: last.seq });
      }

      const unsubscribe = hub.subscribe(device.id, { send, close: () => done() });
      const heartbeat = setInterval(
        () => enqueue(() => stream.write(': ping\n\n')),
        config.sseHeartbeatMs,
      );
      stream.onAbort(() => done());
      c.req.raw.signal.addEventListener('abort', () => done(), { once: true });

      await finished;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      // Flush what is queued (e.g. the last status before a DELETE), but never wait on a
      // client that stopped reading: cancelling the stream rejects its pending writes.
      if (!overflowed) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flushed = await Promise.race([
          chain.then(() => true),
          new Promise<false>((r) => (timer = setTimeout(() => r(false), SSE_FLUSH_MS))),
        ]);
        clearTimeout(timer);
        if (flushed) return;
      }
      stream.abort();
    });
  });

  // ---- housekeeping --------------------------------------------------------------------

  /** Presence (`offline` events) and TTL expiry. `index.ts` runs it every few seconds. */
  const sweep = () => {
    const t = now();
    for (const device of store.listDevices()) {
      if (t - device.lastSeen > config.deviceTtlMs) {
        forgetDevice(device.id);
        log.info('device expired', { deviceId: device.id });
      } else if (device.announcedOnline && t - device.lastSeen > config.onlineWindowMs) {
        device.announcedOnline = false;
        store.putDevice(device);
        hub.publish(device.id, { event: 'offline', data: { lastSeen: device.lastSeen } });
      }
    }
    for (const build of store.listBuilds()) {
      if (t - build.updatedAt > config.buildTtlMs) {
        store.deleteBuild(build.id);
        const device = store.getDevice(build.deviceId);
        if (device?.pendingBuildId === build.id) {
          device.pendingBuildId = null;
          store.putDevice(device);
        }
      }
    }
    const longest = Math.max(...Object.values(config.limits).map((l) => l.windowMs));
    limiter.sweep(longest);
  };

  return { app, store, hub, limiter, sweep, config };
}

export type Relay = ReturnType<typeof createRelay>;

function isShortString(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_FIELD;
}
