/// <reference lib="dom" />
// ^ the init scripts below run in the page, where `window` exists.
import process from 'node:process';
import { expect, test } from '@playwright/test';

// Real compile against a running server (e.g. `docker run -p 3032:3030 som-compile:dev`).
// Skipped unless LIVE_COMPILE_URL is set, so CI (no server) never runs it:
//   LIVE_COMPILE_URL=http://127.0.0.1:3032 pnpm test:e2e --grep @live
const liveUrl = process.env.LIVE_COMPILE_URL;

const cases = [
  { boardId: 'uno', expected: /Listo en [\d.]+ s · firmware \d+ bytes/ },
  { boardId: 'esp32c3-supermini', expected: /Listo en [\d.]+ s · 4 imágenes \(\d+ bytes\)/ },
];

for (const { boardId, expected } of cases) {
  test(`@live compiles the default workspace for ${boardId} on a real server`, async ({
    page,
  }, testInfo) => {
    test.skip(!liveUrl, 'LIVE_COMPILE_URL not set');
    test.setTimeout(120_000);

    await page.addInitScript((url) => {
      window.localStorage.setItem('som.compileServerUrl', url);
    }, liveUrl!);
    await page.goto('/?lang=es');
    await page.getByTestId('board-picker').selectOption(boardId);
    await expect(page.getByTestId('generated-code')).toContainText('void loop() {');
    await page.getByRole('button', { name: 'Compilar', exact: true }).click();

    const status = page.getByTestId('compile-status');
    await expect(status).toContainText(expected, { timeout: 90_000 });

    const statusText = (await status.textContent()) ?? '';
    const log = (await page.getByTestId('compile-log').textContent()) ?? '';
    expect(log).toContain('Sketch uses');
    await page.screenshot({ path: testInfo.outputPath(`live-${boardId}.png`), fullPage: true });
    await testInfo.attach('status', { body: statusText, contentType: 'text/plain' });
    await testInfo.attach('log', { body: log, contentType: 'text/plain' });
    console.log(`[${boardId}] STATUS: ${statusText}\nLOG:\n${log}`);
  });
}
