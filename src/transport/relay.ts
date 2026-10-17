import type { WifiPairing } from '../wifi/pairing';
import {
  followEvents,
  getDevice,
  postInput,
  RelayError,
  type EventCursor,
  type RelayEndpoint,
} from '../wifi/relay-client';
import { TransportError, type Transport } from './types';

// WiFi transport through the device relay (_config/architecture.md → Transports and Track D).
// Down: the relay's event stream (`serial` lines, `online`/`offline`), read with fetch()
// because EventSource cannot send the bearer token; it reconnects by itself with
// Last-Event-ID, so a dropped connection never loses or repeats a line. Up: `POST /input`,
// one request per line, in order. The serial monitor and plotter see the same `Transport`
// as over USB.

/** The relay's own limit for one typed line (server/relay/src/config.ts maxInputLineChars). */
export const MAX_INPUT_LINE = 1024;

export type Presence = 'online' | 'offline' | 'unknown';

export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  readonly pairing: WifiPairing;

  private controller: AbortController | null = null;
  private following: Promise<void> = Promise.resolve();
  /** Kept across close/open (a baud change, an upload): the reopen resumes from here. */
  private readonly cursor: EventCursor = {};
  private writeChain: Promise<void> = Promise.resolve();
  private presenceValue: Presence = 'unknown';
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly presenceListeners = new Set<(presence: Presence) => void>();
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(pairing: WifiPairing) {
    this.pairing = pairing;
  }

  get endpoint(): RelayEndpoint {
    const { relayUrl, deviceId, token } = this.pairing;
    return { relayUrl, deviceId, token };
  }

  get isOpen(): boolean {
    return this.controller !== null;
  }

  /** Whether the board itself is connected to the relay (not just this page). */
  get presence(): Presence {
    return this.presenceValue;
  }

  /**
   * Checks the pairing against the relay, then starts following the board's events. Fails
   * on a token the relay refuses (re-pair) or an unreachable relay; a board that is not
   * registered right now (off, or the relay restarted) opens fine and shows as offline.
   */
  // No baud over WiFi: the options are accepted for the Transport interface and ignored.
  async open(): Promise<void> {
    if (this.controller) throw new TransportError('open-failed', 'already open');
    const controller = new AbortController();
    try {
      const device = await getDevice(this.endpoint, controller.signal);
      this.setPresence(device.online ? 'online' : 'offline');
    } catch (error) {
      if (!(error instanceof RelayError)) throw new TransportError('open-failed', String(error));
      if (error.code === 'unauthorized') throw new TransportError('unauthorized', error.message);
      if (error.code === 'network') throw new TransportError('unreachable', error.message);
      if (error.code !== 'unknown-device') throw new TransportError('open-failed', error.message);
      this.setPresence('offline');
    }
    this.controller = controller;
    this.following = followEvents(
      this.endpoint,
      {
        onEvent: (event) => {
          if (this.controller !== controller) return;
          if (event.type === 'online' || event.type === 'offline') this.setPresence(event.type);
          else if (event.type === 'serial') this.emit(event.lines);
        },
        onUnknownDevice: () => {
          if (this.controller === controller) this.setPresence('offline');
        },
        onFatal: () => {
          if (this.controller !== controller) return;
          this.controller = null;
          controller.abort();
          for (const listener of [...this.disconnectListeners]) listener();
        },
      },
      controller.signal,
      this.cursor,
    );
  }

  async close(): Promise<void> {
    const controller = this.controller;
    this.controller = null;
    controller?.abort();
    await this.following;
    await this.writeChain.catch(() => undefined);
  }

  /**
   * The relay is line-based: the text is split at line breaks and each line is one `POST
   * /input`, sent in order; a trailing line break adds no empty line. Text without a line
   * break still arrives at the board as one line. Over-long lines are cut into pieces the
   * relay accepts.
   */
  write(data: Uint8Array): Promise<void> {
    const run = async () => {
      if (!this.controller) throw new TransportError('not-open');
      const text = this.decoder.decode(data);
      if (text === '') return;
      const lines = text.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);
      for (const line of lines) {
        for (let start = 0; start === 0 || start < line.length; start += MAX_INPUT_LINE) {
          try {
            await postInput(this.endpoint, line.slice(start, start + MAX_INPUT_LINE));
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new TransportError('write-failed', detail);
          }
        }
      }
    };
    const result = this.writeChain.then(run, run);
    this.writeChain = result.catch(() => undefined);
    return result;
  }

  onData(cb: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  /** Fires when the relay stops accepting this pairing (the board rotated its token). */
  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  onPresence(cb: (presence: Presence) => void): () => void {
    this.presenceListeners.add(cb);
    return () => this.presenceListeners.delete(cb);
  }

  private setPresence(presence: Presence): void {
    if (presence === this.presenceValue) return;
    this.presenceValue = presence;
    for (const listener of [...this.presenceListeners]) listener(presence);
  }

  private emit(lines: string[]): void {
    const chunk = this.encoder.encode(lines.map((line) => `${line}\n`).join(''));
    for (const listener of [...this.dataListeners]) listener(chunk);
  }
}
