// @vitest-environment node
import { Buffer } from 'buffer';
import SOURCE from 'avrgirl-arduino/dist/avrgirl-arduino.global.min.js?raw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeStk500Port, intelHex } from '../test/fake-stk500';
import type { AvrgirlConstructor } from './avrgirl';
import { DrainingPort } from './stk500-port';

// Why avrgirl must be loaded as a classic <script> and never `import()`ed (avrgirl.ts).
//
// The REAL avrgirl bundle (dist/avrgirl-arduino.global.min.js, the file we ship) runs here
// against a fake stk500v1 bootloader (src/test/fake-stk500.ts), in two modes:
// - sloppy, like a classic script: the upload completes;
// - strict, like the ES-module chunk Vite makes of any imported file: the bundled stk500's
//   `match = Buffer.concat(...)` (no declaration) throws "match is not defined" in
//   verifySignature, avrgirl's read loop swallows it with console.error and the upload stalls
//   after the third GET_SYNC, before READ_SIGN (`75 20`) is ever written. That is the hang the
//   real NANO showed.
// Plus the old-bootloader NANO's late first sync reply: on the raw port it can overflow
// stk500's READ_SIGN buffer; through the DrainingPort we lend avrgirl the upload completes.

const PROGRAM = Array.from({ length: 160 }, (_, i) => (i * 7 + 3) & 0xff); // 2 pages
const HEX = new TextEncoder().encode(intelHex(PROGRAM));

type Globals = {
  window?: unknown;
  AvrgirlArduino?: AvrgirlConstructor;
  match?: unknown;
};

function evaluateBundle(strict: boolean): AvrgirlConstructor {
  const g = globalThis as unknown as Globals;
  g.window = g;
  delete g.AvrgirlArduino;
  delete g.match;
  // Indirect eval runs in the global scope, sloppy unless the code says 'use strict'.
  const globalEval = eval;
  globalEval(`(function () {${strict ? "'use strict';" : ''}\n${SOURCE}\n})();`);
  if (!g.AvrgirlArduino) throw new Error('bundle did not define AvrgirlArduino');
  return g.AvrgirlArduino;
}

interface Outcome {
  result: 'complete' | 'error' | 'stalled';
  error?: string;
  consoleErrors: string[];
}

function flash(Avrgirl: AvrgirlConstructor, lent: unknown, stallMs = 2_500): Promise<Outcome> {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serial: { requestPort: async () => lent, getPorts: async () => [] } },
  });
  const consoleErrors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return new Promise<Outcome>((resolve) => {
    const timer = setTimeout(() => resolve({ result: 'stalled', consoleErrors }), stallMs);
    new Avrgirl({ board: 'nano' }).flash(Buffer.from(HEX), (error) => {
      clearTimeout(timer);
      resolve(
        error
          ? { result: 'error', error: String((error as Error).message), consoleErrors }
          : { result: 'complete', consoleErrors },
      );
    });
  });
}

describe('the real avrgirl bundle against a fake NANO bootloader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('as a classic (sloppy) script: the upload completes and verifies', async () => {
    const port = new FakeStk500Port();
    const outcome = await flash(evaluateBundle(false), port);
    expect(outcome.result).toBe('complete');
    expect(port.commands).toContain('75 20');
    expect(port.read(0, PROGRAM.length)).toEqual(PROGRAM);
  }, 10_000);

  it('as strict code (what an ES module is): "match is not defined", stalls before READ_SIGN', async () => {
    const port = new FakeStk500Port();
    const outcome = await flash(evaluateBundle(true), port);
    expect(outcome.result).toBe('stalled');
    expect(outcome.consoleErrors.join('\n')).toMatch(/ReferenceError: match is not defined/);
    expect(port.commands.filter((c) => c === '30 20')).toHaveLength(3);
    expect(port.commands).not.toContain('75 20');
  }, 10_000);

  // On the raw port a late first sync reply usually fails READ_SIGN with "buffer overflow
  // 7 > 5" (seen in the Node repro and in this harness), but whether the stale reply lands in
  // READ_SIGN depends on timer order under load, so it is not asserted here; the drain itself
  // is tested deterministically in stk500-port.test.ts.
  it('a late first sync reply completes through the DrainingPort we lend avrgirl', async () => {
    const port = new FakeStk500Port({ firstSyncDelayMs: 410 });
    const drained: number[] = [];
    const wrapped = new DrainingPort(port, (count) => drained.push(count));
    const outcome = await flash(evaluateBundle(false), wrapped);
    expect(outcome.result).toBe('complete');
    expect(drained.reduce((a, b) => a + b, 0)).toBe(2); // the stale `14 10`
    expect(port.read(0, PROGRAM.length)).toEqual(PROGRAM);
    await wrapped.shutdown();
    expect(port.readable).toBeNull();
  }, 10_000);
});
