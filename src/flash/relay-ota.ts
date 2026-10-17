import type { BoardDefinition } from '../boards/types';
import type { CompileResult } from '../compile/types';
import { RelayTransport } from '../transport/relay';
import type { Transport } from '../transport/types';
import {
  followEvents,
  getBuild,
  getDevice,
  postBuild,
  RelayError,
  type BuildState,
  type RelayEndpoint,
} from '../wifi/relay-client';
import { FlashError, type Flasher, type FlashHooks, type FlashProgress } from './types';

// Upload over WiFi: the compiled app image goes to the relay, the board pulls it and reports
// `downloading → flashing → rebooting → running` (or `failed`), and the editor follows those
// `status` events to drive the progress bar (_config/architecture.md → Track D → "Relay
// service" and "Editor side"). Loss rule from the same section: the editor never infers loss
// from its own connectivity. After every (re)connection of the event stream it asks
// `GET /v1/builds/{id}`: a terminal state ends the upload, any other state means keep
// following, and only a 404 with the board online again means the relay lost the build —
// then the same image is posted once more. A board that stays silent for 60 s while online is
// a warning in the log, not a failure; the whole upload gives up after 3 minutes.

/** Where the compile server puts the application image (the one an OTA slot takes). */
export const APP_IMAGE_ADDRESS = 0x10000;
/** The relay's image limit (server/relay/src/config.ts maxImageBytes). */
export const MAX_OTA_IMAGE_BYTES = 2 * 1024 * 1024;

export const otaTiming = {
  /** The whole upload, from the first request to `running`. */
  deadlineMs: 180_000,
  /** Board online but no status for this long: say so in the log. */
  silenceWarnMs: 60_000,
  /** How long to wait for the event stream before posting anyway. */
  streamOpenMs: 10_000,
};

const PROGRESS: Record<Exclude<BuildState, 'failed'>, FlashProgress> = {
  queued: { phase: 'connect', percent: 10 },
  downloading: { phase: 'write', percent: 25 },
  flashing: { phase: 'write', percent: 60 },
  rebooting: { phase: 'reset', percent: 90 },
  running: { phase: 'done', percent: 100 },
};

/** The app image (0x10000) of an esp compile result; bootloader and partitions stay put. */
export function appImage(result: CompileResult, board: Pick<BoardDefinition, 'id'>): Uint8Array {
  if (result.kind !== 'esp') {
    throw new FlashError('unsupported-board', `${board.id} needs an esp build, got ${result.kind}`);
  }
  const app = result.images.find((image) => image.address === APP_IMAGE_ADDRESS);
  if (!app) {
    throw new FlashError(
      'write-failed',
      `no app image at 0x10000 (got ${result.images.map((i) => `0x${i.address.toString(16)}`).join(', ')})`,
    );
  }
  return app.data;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function postError(error: unknown): FlashError {
  if (error instanceof FlashError) return error;
  if (!(error instanceof RelayError)) return new FlashError('transport', String(error));
  switch (error.code) {
    case 'unauthorized':
      return new FlashError('ota-unauthorized', error.message);
    case 'unknown-device':
      return new FlashError('ota-offline', error.message);
    case 'too-large':
      return new FlashError('ota-too-big', error.message);
    case 'network':
      return new FlashError('transport', error.message);
    default:
      return new FlashError(
        'ota-failed',
        error.retryAfterSec
          ? `${error.message} (retry in ${error.retryAfterSec} s)`
          : error.message,
      );
  }
}

/** Runs one upload; resolves on `running`, rejects with a FlashError otherwise. */
function runUpload(
  endpoint: RelayEndpoint,
  image: Uint8Array,
  sha256: string,
  hooks: FlashHooks,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = new AbortController();
    let settled = false;
    let buildId: string | null = null;
    let reposted = false;
    let online = false;
    let suspectLost = false;
    let checking = false;
    let percent = 0;
    let lastState: BuildState | null = null;
    let lastNews = Date.now();
    let warned = false;
    /** Status events that arrived before the POST answered with our build id. */
    const early: { buildId: string; state: BuildState; detail?: string }[] = [];
    let streamOpened: () => void = () => {};
    const opened = new Promise<void>((r) => (streamOpened = r));

    const finish = (error?: FlashError) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(silence);
      hooks.signal?.removeEventListener('abort', onAbort);
      stream.abort();
      if (error) reject(error);
      else resolve();
    };

    const apply = (state: BuildState, detail?: string) => {
      if (settled) return;
      // A recheck that repeats the state we know is not news from the board.
      if (state === lastState) return;
      lastState = state;
      lastNews = Date.now();
      warned = false;
      hooks.onLog(`board: ${state}${detail ? ` (${detail})` : ''}`);
      if (state === 'failed') {
        finish(new FlashError('ota-failed', detail ?? 'the board reported failed'));
        return;
      }
      const progress = PROGRESS[state];
      // A recheck may report an earlier state than an event already did: never go back.
      if (progress.percent > percent) {
        percent = progress.percent;
        hooks.onProgress(progress);
      }
      if (state === 'running') finish();
    };

    const post = async () => {
      buildId = null;
      const id = await postBuild(endpoint, image, sha256, stream.signal);
      if (settled) return;
      buildId = id;
      hooks.onLog(`relay: build ${id} queued (${image.byteLength} bytes)`);
      for (const event of early.splice(0)) {
        if (event.buildId === id) apply(event.state, event.detail);
      }
    };

    /** The architecture's reconnect rule: ask the relay what became of our build. */
    const recheck = async () => {
      if (settled || buildId === null || checking) return;
      checking = true;
      try {
        const { state, detail } = await getBuild(endpoint, buildId, stream.signal);
        suspectLost = false;
        apply(state, detail);
      } catch (error) {
        if (settled) return;
        if (!(error instanceof RelayError)) return;
        if (error.code === 'unauthorized') {
          finish(new FlashError('ota-unauthorized', error.message));
          return;
        }
        if (error.code !== 'unknown-build') return; // network: the next reconnect asks again
        const device = await getDevice(endpoint, stream.signal).catch(() => null);
        if (settled) return;
        if (!device?.online) {
          // The board is not back yet; ask again when it is (`online` event or reconnect).
          suspectLost = true;
          return;
        }
        suspectLost = false;
        if (reposted) {
          finish(new FlashError('ota-lost', 'the relay lost the build twice'));
          return;
        }
        reposted = true;
        hooks.onLog('relay: the upload was lost; sending it again');
        percent = 0;
        lastState = null;
        await post().catch((postFailure: unknown) => finish(postError(postFailure)));
      } finally {
        checking = false;
      }
    };

    const deadline = setTimeout(
      () =>
        finish(
          new FlashError(
            'ota-timeout',
            `no result after ${Math.round(otaTiming.deadlineMs / 1000)} s (board ${online ? 'online' : 'offline'})`,
          ),
        ),
      otaTiming.deadlineMs,
    );
    const silence = setInterval(() => {
      if (warned || !online || buildId === null) return;
      if (Date.now() - lastNews >= otaTiming.silenceWarnMs) {
        warned = true;
        hooks.onLog(
          `relay: no news from the board for ${Math.round(otaTiming.silenceWarnMs / 1000)} s; still waiting`,
        );
      }
    }, 5_000);

    const onAbort = () => finish(new FlashError('cancelled'));
    if (hooks.signal?.aborted) return finish(new FlashError('cancelled'));
    hooks.signal?.addEventListener('abort', onAbort, { once: true });

    void followEvents(
      endpoint,
      {
        onEvent: (event) => {
          if (event.type === 'online') {
            online = true;
            if (suspectLost) void recheck();
          } else if (event.type === 'offline') {
            online = false;
          } else if (event.type === 'status') {
            if (buildId === null) early.push(event);
            else if (event.buildId === buildId) apply(event.state, event.detail);
          }
        },
        onOpen: () => {
          streamOpened();
          void recheck();
        },
        onUnknownDevice: () => {
          online = false;
        },
        onFatal: (error) => finish(new FlashError('ota-unauthorized', error.message)),
      },
      stream.signal,
    );

    hooks.onProgress({ phase: 'connect', percent: 0 });
    void (async () => {
      // Follow first, so the `queued` and later events of our build are not missed.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        opened,
        new Promise<void>((r) => (timer = setTimeout(r, otaTiming.streamOpenMs))),
      ]);
      clearTimeout(timer);
      if (settled) return;
      try {
        await post();
      } catch (error) {
        finish(postError(error));
      }
    })();
  });
}

export const relayOtaFlasher: Flasher = {
  // The board pulls the image whenever it is ready; there is no way to take a queued build
  // back from the relay, so the UI offers no Cancel.
  supportsCancel: false,

  async flash(result: CompileResult, board: BoardDefinition, transport: Transport, hooks) {
    if (!(transport instanceof RelayTransport)) throw new FlashError('no-port');
    const image = appImage(result, board);
    if (image.byteLength > MAX_OTA_IMAGE_BYTES) {
      throw new FlashError('ota-too-big', `${image.byteLength} bytes > 2 MB`);
    }
    const sha256 = await sha256Hex(image);
    hooks.onLog(`app image ${image.byteLength} bytes, sha256 ${sha256.slice(0, 12)}…`);
    await runUpload(transport.endpoint, image, sha256, hooks);
  },
};
