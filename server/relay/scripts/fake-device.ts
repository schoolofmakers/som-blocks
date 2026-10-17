// A stand-in for the resident firmware, for end-to-end runs against a local relay:
// register → long-poll `next` → download → status progression → serial batches, plus the
// `input` long-poll echoed back to serial. Usage: see README → "Fake device".
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    relay: { type: 'string', default: 'http://127.0.0.1:8080' },
    device: { type: 'string', default: 'fa4e00c3c3c3' },
    token: { type: 'string' },
    'previous-token': { type: 'string' },
    name: { type: 'string', default: 'placa-falsa' },
    builds: { type: 'string', default: '0' },
    wait: { type: 'string', default: '25' },
  },
});

const relay = args.relay.replace(/\/$/, '');
const deviceId = args.device;
const token = args.token ?? randomBytes(32).toString('hex');
const exitAfter = Number(args.builds);
const headers = { Authorization: `Bearer ${token}` };
let fw = 'fake-resident-0.1';
let buildsDone = 0;
let stopping = false;
const pendingSerial: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (msg: string) =>
  console.log(`${new Date().toISOString().slice(11, 23)} [device] ${msg}`);

async function call(path: string, init: RequestInit = {}) {
  return fetch(`${relay}${path}`, {
    ...init,
    headers: { ...headers, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function backoff(res: Response) {
  const s = Number(res.headers.get('retry-after') ?? 5);
  say(`429, backing off ${s}s`);
  await sleep(s * 1000);
}

async function register(previousToken?: string) {
  const res = await call(`/v1/devices/${deviceId}/register`, {
    method: 'POST',
    body: JSON.stringify({ fw, name: args.name, chip: 'esp32c3', previousToken }),
  });
  say(`register → ${res.status}`);
  if (res.status === 409) throw new Error('relay refused this token (409); see README');
  if (res.status === 429) await backoff(res);
}

async function status(buildId: string, state: string, detail?: string) {
  const res = await call(`/v1/devices/${deviceId}/status`, {
    method: 'POST',
    body: JSON.stringify({ buildId, state, detail }),
  });
  say(`status ${state}${detail ? ` (${detail})` : ''} → ${res.status}`);
}

async function runBuild(build: { buildId: string; size: number; sha256: string }) {
  say(`build ${build.buildId} queued: ${build.size} bytes, sha256 ${build.sha256.slice(0, 12)}…`);
  await status(build.buildId, 'downloading');
  const res = await fetch(`${relay}/v1/builds/${build.buildId}/image`, { headers });
  if (res.status !== 200 || !res.body) {
    await status(build.buildId, 'failed', `download ${res.status}`);
    return;
  }
  say(`image → ${res.status}, Content-Length ${res.headers.get('content-length')}`);
  const hash = createHash('sha256');
  let got = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    got += chunk.byteLength;
  }
  const sha = hash.digest('hex');
  if (got !== build.size || sha !== build.sha256) {
    await status(build.buildId, 'failed', `size ${got}/${build.size} or sha mismatch`);
    return;
  }
  say(`downloaded ${got} bytes, sha256 verified`);
  await status(build.buildId, 'flashing');
  await sleep(300);
  await status(build.buildId, 'rebooting');
  await sleep(500);
  fw = `sketch-${build.buildId.slice(0, 8)}`;
  await register(); // what the board does on boot
  await status(build.buildId, 'running');
  pendingSerial.push(`[sketch] hola desde ${fw}`);
}

async function nextLoop() {
  while (!stopping) {
    const res = await call(`/v1/devices/${deviceId}/next?wait=${args.wait}`);
    if (res.status === 204) continue;
    if (res.status === 404) {
      say('next → 404 (record gone), re-registering');
      await register();
      continue;
    }
    if (res.status === 429) {
      await backoff(res);
      continue;
    }
    if (res.status !== 200) throw new Error(`next → ${res.status}`);
    await runBuild((await res.json()) as { buildId: string; size: number; sha256: string });
    buildsDone++;
    if (exitAfter > 0 && buildsDone >= exitAfter) {
      await sleep(1200); // let the last serial batch go out
      stopping = true;
    }
  }
}

async function inputLoop() {
  while (!stopping) {
    const res = await call(`/v1/devices/${deviceId}/input?wait=${args.wait}`).catch(() => null);
    if (!res) continue;
    if (res.status === 200) {
      const { lines } = (await res.json()) as { lines: string[] };
      for (const line of lines) {
        say(`input "${line}"`);
        pendingSerial.push(`eco: ${line}`);
      }
    } else if (res.status === 429) await backoff(res);
    else if (res.status !== 204) await sleep(1000);
  }
}

async function serialLoop() {
  let tick = 0;
  while (!stopping) {
    await sleep(500);
    if (++tick % 4 === 0) pendingSerial.push(`uptime ${tick / 2}s`);
    if (pendingSerial.length === 0) continue;
    const lines = pendingSerial.splice(0, 50);
    const res = await call(`/v1/devices/${deviceId}/serial`, {
      method: 'POST',
      body: JSON.stringify({ lines }),
    });
    if (res.status === 429) await backoff(res);
    else say(`serial ${JSON.stringify(lines)} → ${res.status}`);
  }
}

say(`relay ${relay}, device ${deviceId}`);
say(`token ${token}  (the editor uses this as its bearer)`);
await register(args['previous-token']);
void inputLoop();
void serialLoop();
await nextLoop();
say('done');
process.exit(0);
