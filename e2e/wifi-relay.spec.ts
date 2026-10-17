import { expect, test, type Page, type Route } from '@playwright/test';

// The WiFi path end to end in a real browser against a mocked relay (Playwright routes that
// follow server/relay/src/app.ts): a `/pair` link pairs the open project, "Conectar por WiFi"
// opens the relay transport (fetch + SSE reader with the bearer token), the serial monitor
// shows the board's lines, and an OTA upload follows `status` events to "¡Listo!". The real
// relay + fake device run is in the PR description.

const RELAY = 'http://127.0.0.1:59997';
const SERVER = 'http://127.0.0.1:59996';
const DEVICE = 'fa4e00c3c3c3';
const TOKEN = '0123456789abcdef'.repeat(4);
const APP = Buffer.from([0xe9, 0x05, 0x02, 0x20, 1, 2, 3, 4, 5, 6, 7, 8]);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, X-Image-Sha256, Last-Event-ID',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

interface RelayLog {
  authorized: boolean[];
  urls: string[];
  posted: { sha: string | null; bytes: number }[];
  inputs: string[];
  lastEventIds: (string | null)[];
}

const sse = (events: { event: string; data: unknown; id?: number }[]) =>
  events
    .map(
      (e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n${e.id ? `id: ${e.id}\n` : ''}\n`,
    )
    .join('');

async function mockRelay(page: Page): Promise<RelayLog> {
  const log: RelayLog = { authorized: [], urls: [], posted: [], inputs: [], lastEventIds: [] };
  let buildState: string | null = null;
  await page.route(`${RELAY}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    log.urls.push(url.href);
    log.authorized.push(req.headers().authorization === `Bearer ${TOKEN}`);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const base = `/v1/devices/${DEVICE}`;
    if (url.pathname === base) {
      return json({ online: true, lastSeen: 1, fw: 'resident-0.1', name: 'placa-azul' });
    }
    if (url.pathname === `${base}/events`) {
      log.lastEventIds.push(req.headers()['last-event-id'] ?? null);
      // Each connection gets the presence, the board's lines so far (ids let the editor
      // drop what it already showed after a reconnect) and, once a build is in, its states.
      const events: { event: string; data: unknown; id?: number }[] = [
        { event: 'online', data: { lastSeen: 1 } },
        { event: 'serial', data: { lines: ['hola desde la placa'] }, id: 1 },
      ];
      if (buildState) {
        for (const state of ['queued', 'downloading', 'flashing', 'rebooting', 'running']) {
          events.push({ event: 'status', data: { buildId: 'b1', state } });
        }
        events.push({ event: 'serial', data: { lines: ['programa nuevo corriendo'] }, id: 2 });
      }
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
        body: sse(events),
      });
    }
    if (url.pathname === `${base}/builds` && req.method() === 'POST') {
      log.posted.push({
        sha: req.headers()['x-image-sha256'] ?? null,
        bytes: req.postDataBuffer()?.length ?? 0,
      });
      buildState = 'queued';
      return json({ buildId: 'b1' }, 201);
    }
    if (url.pathname === '/v1/builds/b1') {
      return buildState ? json({ state: 'running' }) : json({ error: 'unknown_build' }, 404);
    }
    if (url.pathname === `${base}/input` && req.method() === 'POST') {
      log.inputs.push((JSON.parse(req.postData() ?? '{}') as { line: string }).line);
      return route.fulfill({ status: 204, headers: cors });
    }
    return json({ error: 'not_found' }, 404);
  });
  return log;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ relay, server }) => {
      window.localStorage.setItem('som.relayUrl', relay);
      window.localStorage.setItem('som.compileServerUrl', server);
    },
    { relay: RELAY, server: SERVER },
  );
  await page.route(`${SERVER}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors });
    }
    // An esp32-c3 build: bootloader, partitions, boot_app0, app.
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        files: [
          { address: 0x1000, data: Buffer.from([0xe9, 0]).toString('base64') },
          { address: 0x8000, data: Buffer.from([0xaa, 0x50]).toString('base64') },
          { address: 0xe000, data: Buffer.from([0x01]).toString('base64') },
          { address: 0x10000, data: APP.toString('base64') },
        ],
        flash_mode: 'dio',
        flash_freq: '80m',
        log: 'Sketch uses 12 bytes.',
      }),
    });
  });
});

async function pairAndConnect(page: Page) {
  await page.goto(`/pair?device=${DEVICE}&token=${TOKEN}&lang=es`);
  await expect(page.getByTestId('project-notice')).toHaveText(
    /Placa placa-azul emparejada con este proyecto\./,
  );
  // The token left the address bar (and the history entry) before anything rendered.
  expect(page.url()).not.toContain(TOKEN);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.getByTestId('connect-button').click();
  await expect(page.getByTestId('wifi-paired')).toHaveText('Placa de este proyecto: placa-azul');
  await page.getByTestId('connect-wifi').click();
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada por WiFi');
  await expect(page.getByTestId('wifi-presence')).toHaveText('La placa está conectada a WiFi.');
  await page.keyboard.press('Escape');
}

test('a /pair link pairs the project and the monitor works over the relay', async ({ page }) => {
  const relay = await mockRelay(page);
  await pairAndConnect(page);

  await page.getByTestId('serial-panel-toggle').click();
  const terminal = page.getByTestId('serial-terminal');
  await expect(terminal).toContainText('hola desde la placa');
  // The stream ends after each mocked reply, so the editor reconnects with Last-Event-ID
  // and drops the line it already showed.
  await expect.poll(() => relay.lastEventIds.filter((id) => id === '1').length).toBeGreaterThan(0);
  await page.getByRole('textbox', { name: 'Mensaje para la placa' }).fill('led on');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect.poll(() => relay.inputs).toEqual(['led on']);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar .txt' }).click(),
  ]);
  const saved = await (await download.createReadStream()).toArray();
  expect(
    Buffer.concat(saved)
      .toString()
      .match(/hola desde la placa/g),
  ).toHaveLength(1);
  // Every relay call carried the bearer token; no URL ever did.
  expect(relay.authorized.every(Boolean)).toBe(true);
  expect(relay.urls.some((u) => u.includes(TOKEN))).toBe(false);
});

test('an OTA upload over WiFi follows the board to ¡Listo!', async ({ page }) => {
  const relay = await mockRelay(page);
  await pairAndConnect(page);

  // Over WiFi the project must be flagged "Subir por WiFi" (SomLink in the sketch).
  await expect(page.getByTestId('upload-reason')).toHaveText(
    'Activa «Subir por WiFi» en el menú Proyectos para subir sin cable.',
  );
  await page.getByText('Proyectos', { exact: true }).click();
  await page.getByTestId('project-upload-wifi').click();
  await expect(page.getByTestId('generated-code')).toContainText('#include <SomLink.h>');

  const compile = page.waitForRequest(`${SERVER}/v3/compile`);
  await page.getByRole('button', { name: 'Compilar', exact: true }).click();
  const body = (await compile).postDataJSON() as { fqbn: string };
  expect(body.fqbn).toBe('esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs');
  await expect(page.getByTestId('compile-status')).toContainText('Listo en');

  await page.getByTestId('upload-button').click();
  await expect(page.getByTestId('upload-status')).toHaveText(
    /¡Listo! Tu programa ya está en la placa\./,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('upload-error')).toHaveCount(0);
  expect(relay.posted).toHaveLength(1);
  // Only the app image (0x10000) went up, with its sha256.
  expect(relay.posted[0]?.bytes).toBe(APP.length);
  const { createHash } = await import('node:crypto');
  expect(relay.posted[0]?.sha).toBe(createHash('sha256').update(APP).digest('hex'));
  await expect(page.getByTestId('compile-log')).toContainText('board: running');
  await expect(page.getByTestId('connect-status')).toHaveText('Conectada por WiFi');
  await page.getByTestId('serial-panel-toggle').click();
  await expect(page.getByTestId('serial-terminal')).toContainText('programa nuevo corriendo');
});
