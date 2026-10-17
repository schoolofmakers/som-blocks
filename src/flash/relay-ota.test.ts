import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBoard } from '../boards/registry';
import type { EspCompileResult } from '../compile/types';
import { FakeRelay, PAIRING, settle, TOKEN } from '../test/fake-relay';
import { fakeTransport } from '../test/fake-transport';
import { RelayTransport } from '../transport/relay';
import { followTiming } from '../wifi/relay-client';
import { appImage, MAX_OTA_IMAGE_BYTES, otaTiming, relayOtaFlasher, sha256Hex } from './relay-ota';
import { FlashError, type FlashProgress } from './types';

const board = getBoard('esp32c3-supermini');
const APP = new Uint8Array([0xe9, 1, 2, 3, 4, 5]);

function espResult(app: Uint8Array = APP): EspCompileResult {
  return {
    kind: 'esp',
    images: [
      { address: 0x1000, data: new Uint8Array([0xe9, 0]) },
      { address: 0x8000, data: new Uint8Array([0xaa]) },
      { address: 0xe000, data: new Uint8Array([0xbb]) },
      { address: 0x10000, data: app },
    ],
    log: '',
  };
}

describe('appImage / sha256Hex', () => {
  it('picks the image at 0x10000 only', () => {
    expect(appImage(espResult(), board)).toBe(APP);
  });

  it('refuses an AVR result or a result without an app image', () => {
    expect(() => appImage({ kind: 'avr', hex: new Uint8Array(), log: '' }, board)).toThrow(
      FlashError,
    );
    expect(() =>
      appImage({ kind: 'esp', images: [{ address: 0, data: APP }], log: '' }, board),
    ).toThrow(/no app image at 0x10000/);
  });

  it('hashes with WebCrypto, hex lower-case', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('relayOtaFlasher', () => {
  let relay: FakeRelay;
  let restore: () => void;
  let progress: FlashProgress[];
  let log: string[];
  const hooks = () => ({
    onProgress: (p: FlashProgress) => progress.push(p),
    onLog: (line: string) => log.push(line),
  });

  beforeEach(() => {
    relay = new FakeRelay();
    restore = relay.install();
    progress = [];
    log = [];
  });

  afterEach(() => {
    restore();
    vi.useRealTimers();
  });

  const transport = () => new RelayTransport(PAIRING);
  const buildPost = () => relay.requests.filter((r) => r.path.endsWith('/builds'));

  it('posts the app image with its sha256 and follows the states to done', async () => {
    relay.nextBuild = ['b1'];
    const flashing = relayOtaFlasher.flash(espResult(), board, transport(), hooks());
    await settle(10);
    const [post] = buildPost();
    expect([...(post?.body ?? [])]).toEqual([...APP]);
    expect(post?.headers['x-image-sha256']).toBe(await sha256Hex(APP));
    expect(post?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const state of ['queued', 'downloading', 'flashing', 'rebooting', 'running']) {
      relay.stream.push('status', { buildId: 'b1', state });
    }
    await flashing;
    expect(progress).toEqual([
      { phase: 'connect', percent: 0 },
      { phase: 'connect', percent: 10 },
      { phase: 'write', percent: 25 },
      { phase: 'write', percent: 60 },
      { phase: 'reset', percent: 90 },
      { phase: 'done', percent: 100 },
    ]);
    expect(log.join('\n')).not.toContain(TOKEN);
    expect(relay.stream.closed).toBe(true);
  });

  it('ignores other builds and turns failed into a FlashError with the detail', async () => {
    relay.nextBuild = ['b1'];
    const flashing = relayOtaFlasher.flash(espResult(), board, transport(), hooks());
    await settle(10);
    relay.stream.push('status', { buildId: 'other', state: 'running' });
    relay.stream.push('status', { buildId: 'b1', state: 'failed', detail: 'sha mismatch' });
    await expect(flashing).rejects.toMatchObject({ code: 'ota-failed', detail: 'sha mismatch' });
  });

  it('after a drop asks GET /v1/builds/{id} and ends on its terminal state', async () => {
    relay.nextBuild = ['b1'];
    const flashing = relayOtaFlasher.flash(espResult(), board, transport(), hooks());
    await settle(10);
    relay.stream.push('status', { buildId: 'b1', state: 'downloading' });
    await settle();
    relay.builds.set('b1', { state: 'running' });
    relay.stream.fail();
    await flashing;
    expect(relay.requests.some((r) => r.path === '/v1/builds/b1')).toBe(true);
    expect(progress.at(-1)).toEqual({ phase: 'done', percent: 100 });
  });

  it('a 404 with the board online re-posts the same image once, then gives up', async () => {
    relay.nextBuild = ['b1', 'b2'];
    const flashing = relayOtaFlasher.flash(espResult(), board, transport(), hooks());
    const outcome = flashing.catch((e: unknown) => e);
    await settle(10);
    relay.builds.clear(); // relay restarted: the build is gone
    relay.stream.fail();
    await new Promise((resolve) => setTimeout(resolve, followTiming.baseBackoffMs + 50));
    await settle(10);
    expect(buildPost()).toHaveLength(2);
    expect(buildPost()[1]?.headers['x-image-sha256']).toBe(await sha256Hex(APP));
    expect(log).toContain('relay: the upload was lost; sending it again');
    relay.builds.clear();
    relay.stream.fail();
    await new Promise((resolve) => setTimeout(resolve, followTiming.baseBackoffMs + 50));
    expect(await outcome).toMatchObject({ code: 'ota-lost' });
    expect(buildPost()).toHaveLength(2);
  });

  it('a 404 while the board is offline waits for it to come back before deciding', async () => {
    relay.nextBuild = ['b1', 'b2'];
    const flashing = relayOtaFlasher.flash(espResult(), board, transport(), hooks());
    await settle(10);
    relay.builds.clear();
    relay.device = { online: false, name: 'placa-azul' };
    relay.stream.fail();
    await new Promise((resolve) => setTimeout(resolve, followTiming.baseBackoffMs + 50));
    await settle(10);
    expect(buildPost()).toHaveLength(1);
    relay.device = { online: true, name: 'placa-azul' };
    relay.stream.push('online', { lastSeen: 1 });
    await settle(10);
    expect(buildPost()).toHaveLength(2);
    relay.stream.push('status', { buildId: 'b2', state: 'running' });
    await flashing;
  });

  it('gives up after 3 minutes and warns once after 60 s of silence', async () => {
    vi.useFakeTimers();
    relay.nextBuild = ['b1'];
    const outcome = relayOtaFlasher
      .flash(espResult(), board, transport(), hooks())
      .catch((e: unknown) => e);
    // WebCrypto hashes on a real thread: wait (advancing the fake clock) until the build is in.
    await vi.waitFor(() => expect(buildPost()).toHaveLength(1));
    relay.stream.push('online', { lastSeen: 1 });
    relay.stream.push('status', { buildId: 'b1', state: 'queued' });
    for (let t = 0; t < otaTiming.silenceWarnMs + 5_000; t += 15_000) {
      relay.stream.comment();
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(log.filter((l) => l.includes('no news from the board'))).toHaveLength(1);
    // The relay's heartbeat keeps the stream alive meanwhile.
    for (let t = 0; t < otaTiming.deadlineMs; t += 15_000) {
      relay.stream.comment();
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(await outcome).toMatchObject({ code: 'ota-timeout' });
  });

  it('maps POST failures: refused token, unknown board, rate limit', async () => {
    relay.buildStatus = 401;
    await expect(
      relayOtaFlasher.flash(espResult(), board, transport(), hooks()),
    ).rejects.toMatchObject({ code: 'ota-unauthorized' });
    relay.buildStatus = 404;
    await expect(
      relayOtaFlasher.flash(espResult(), board, transport(), hooks()),
    ).rejects.toMatchObject({ code: 'ota-offline' });
    relay.buildStatus = 429;
    await expect(
      relayOtaFlasher.flash(espResult(), board, transport(), hooks()),
    ).rejects.toMatchObject({ code: 'ota-failed' });
  });

  it('refuses an image over 2 MB and a USB transport before any request', async () => {
    await expect(
      relayOtaFlasher.flash(
        espResult(new Uint8Array(MAX_OTA_IMAGE_BYTES + 1)),
        board,
        transport(),
        hooks(),
      ),
    ).rejects.toMatchObject({ code: 'ota-too-big' });
    await expect(
      relayOtaFlasher.flash(espResult(), board, fakeTransport(), hooks()),
    ).rejects.toMatchObject({ code: 'no-port' });
    expect(relay.requests).toHaveLength(0);
  });
});
