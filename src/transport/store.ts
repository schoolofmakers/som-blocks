import { create } from 'zustand';
import { getBoard } from '../boards/registry';
import type { MessageKey } from '../i18n/messages';
import { portLabel } from './port-label';
import { TransportError, type Transport, type TransportErrorCode } from './types';
import {
  rememberedPorts,
  requestPort,
  WebSerialTransport,
  type SerialPortInfoLike,
  type SerialPortLike,
} from './web-serial';

/**
 * Baud the connection opens at. The serial monitor (B9) and the flashers (B8) reopen at their
 * own rate; this only claims the port and starts listening.
 */
export const DEFAULT_BAUD_RATE = 115200;

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionError {
  key: MessageKey;
  /** Browser error text, shown verbatim under the message (never swallowed). */
  detail?: string;
}

export interface ConnectOptions {
  /** A remembered port (from `rememberedPorts()`): opens without the chooser. */
  port?: SerialPortLike;
  /** Show every serial port, for clones whose USB bridge is not in the board registry. */
  anyPort?: boolean;
}

interface TransportState {
  status: ConnectionStatus;
  portLabel: string | null;
  error: ConnectionError | null;
  transport: Transport | null;
  /** Baud the open transport runs at (DEFAULT_BAUD_RATE right after connect). */
  baudRate: number;
  /**
   * True while the store looks for the board again after it went away (status 'connecting'):
   * a native-USB ESP32-C3 re-enumerates on every reset, so its port disappears and comes back
   * as a new `SerialPort` a moment later.
   */
  reconnecting: boolean;
  connect: (boardId: string, options?: ConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Closes and reopens the open transport at another baud (the serial monitor's baud picker).
   * A port that will not reopen ends the connection with an error, like a failed connect.
   */
  reopen: (baudRate: number) => Promise<void>;
}

const ERROR_KEYS: Record<TransportErrorCode, MessageKey> = {
  unsupported: 'UI_CONNECT_ERROR_UNSUPPORTED',
  cancelled: 'UI_CONNECT_ERROR_CANCELLED',
  blocked: 'UI_CONNECT_ERROR_BLOCKED',
  'open-failed': 'UI_CONNECT_ERROR_OPEN_FAILED',
  'not-open': 'UI_CONNECT_ERROR_UNKNOWN',
  'write-failed': 'UI_CONNECT_ERROR_UNKNOWN',
  disconnected: 'UI_CONNECT_ERROR_DISCONNECTED',
};

function toConnectionError(error: unknown): ConnectionError {
  if (error instanceof TransportError) return { key: ERROR_KEYS[error.code], detail: error.detail };
  return {
    key: 'UI_CONNECT_ERROR_UNKNOWN',
    detail: error instanceof Error ? error.message : String(error),
  };
}

// Bumped by every connect/disconnect so a slow connect that lost the race closes its port
// instead of overwriting newer state.
let attempt = 0;
// The close started by the last disconnect(): the next connect waits for it, so reopening the
// same (remembered) port never races the old connection that still holds it.
let pendingClose: Promise<void> = Promise.resolve();
/**
 * How long a lost connection is looked for again, and how often. Exported for tests.
 * A C3 SuperMini is back on USB well within the window after a reset.
 */
export const reconnectTiming = { windowMs: 6_000, pollMs: 250 };

const sameIds = (a: SerialPortInfoLike, b: SerialPortInfoLike) =>
  a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId;

// The board the current connection was made for (port labels after a reconnect).
let connectedBoardId = '';

// The last reopen() (baud change), including the cleanup when it lost a race. While its
// open() is pending the transport reads as closed, so disconnect()/connect() must wait for the
// whole reopen, or a reconnect to the same port could try to open it while the reopen holds it.
let pendingReopen: Promise<void> = Promise.resolve();

export const useTransportStore = create<TransportState>()((set, get) => {
  /** Publishes `opened` as the connection and follows its unplug. */
  const adopt = (opened: WebSerialTransport, baudRate: number) => {
    opened.onDisconnect(() => {
      if (get().transport !== opened) return;
      void reconnect(opened, get().baudRate, null);
    });
    set({
      status: 'connected',
      transport: opened,
      portLabel: portLabel(opened.nativePort.getInfo(), connectedBoardId),
      error: null,
      baudRate,
      reconnecting: false,
    });
  };

  /**
   * The board went away (unplugged, or reset: a native-USB C3 re-enumerates every time). The
   * site keeps its permission for the device, so look for it in `getPorts()` for a few seconds
   * and open it again, without the chooser, at the same baud. Gives up with `finalError` (or
   * 'disconnected' after a plain unplug) when the window expires. A disconnect() or connect()
   * meanwhile cancels the search (attempt counter).
   */
  const reconnect = async (
    lost: Transport,
    baudRate: number,
    finalError: ConnectionError | null,
  ): Promise<void> => {
    const mine = ++attempt;
    const native = lost.kind === 'web-serial' ? (lost.nativePort as SerialPortLike) : undefined;
    // Only a USB port can be found again; anything else ends right away.
    const info = typeof native?.getInfo === 'function' ? native.getInfo() : undefined;
    set({
      status: 'connecting',
      reconnecting: true,
      transport: null,
      portLabel: null,
      // Keeps the unplug notice in the serial monitor while we look.
      error: { key: 'UI_CONNECT_ERROR_DISCONNECTED' },
    });
    const deadline = info ? performance.now() + reconnectTiming.windowMs : 0;
    while (info && mine === attempt && performance.now() < deadline) {
      // Two identical boards (same VID:PID) cannot be told apart: take the first one that
      // is not open. That is the lost board unless the other one was closed too.
      const candidate = (await rememberedPorts()).find(
        (port) => sameIds(port.getInfo(), info) && !port.readable && !port.writable,
      );
      if (mine !== attempt) return;
      if (candidate) {
        const transport = new WebSerialTransport(candidate);
        try {
          await transport.open({ baudRate });
          if (mine !== attempt) {
            await transport.close();
            return;
          }
          adopt(transport, baudRate);
          return;
        } catch {
          // Not ready yet (still enumerating) or held elsewhere: try again.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, reconnectTiming.pollMs));
    }
    if (mine !== attempt) return;
    set({
      status: finalError ? 'error' : 'disconnected',
      error: finalError ?? { key: 'UI_CONNECT_ERROR_DISCONNECTED' },
      transport: null,
      portLabel: null,
      reconnecting: false,
    });
  };

  return {
    status: 'disconnected',
    portLabel: null,
    error: null,
    transport: null,
    baudRate: DEFAULT_BAUD_RATE,
    reconnecting: false,

    connect: async (boardId, options = {}) => {
      if (get().status === 'connecting') return;
      const board = getBoard(boardId);
      // Nothing may be awaited before requestPort: the chooser needs the click's user activation.
      const pendingPort = options.port
        ? Promise.resolve(options.port)
        : requestPort(options.anyPort ? [] : board.usbFilters);
      const mine = ++attempt;
      const previous = get().transport;
      set({ status: 'connecting', error: null, reconnecting: false });

      let transport: WebSerialTransport | undefined;
      try {
        const port = await pendingPort;
        await pendingClose;
        await pendingReopen;
        // Reconnecting (e.g. to a remembered port) replaces any open connection.
        if (previous) await previous.close();
        transport = new WebSerialTransport(port);
        await transport.open({ baudRate: DEFAULT_BAUD_RATE });
      } catch (error) {
        // The state below forgets `previous`, so it must not stay open behind our back.
        await previous?.close();
        if (mine !== attempt) return;
        const connectionError = toConnectionError(error);
        // Closing the chooser is a choice, not a failure: back to idle with a hint.
        const status =
          connectionError.key === 'UI_CONNECT_ERROR_CANCELLED' ? 'disconnected' : 'error';
        set({ status, error: connectionError, transport: null, portLabel: null });
        return;
      }

      if (mine !== attempt) {
        // A disconnect() or newer connect() ran meanwhile: this port is nobody's any more.
        await transport.close();
        return;
      }
      connectedBoardId = boardId;
      adopt(transport, DEFAULT_BAUD_RATE);
    },

    reopen: (baudRate) => {
      const { transport, status } = get();
      if (!transport || status !== 'connected') return Promise.resolve();
      const mine = ++attempt;
      const run = async () => {
        try {
          await transport.close();
          // A disconnect() or connect() ran meanwhile: leave the port closed, it is not ours.
          if (mine !== attempt) return;
          await transport.open({ baudRate });
        } catch (error) {
          if (mine !== attempt) return;
          await transport.close();
          // The port may be gone for good (a native-USB C3 re-enumerates after the reset that
          // ends an upload): look for it again before giving up with this error.
          await reconnect(transport, baudRate, toConnectionError(error));
          return;
        }
        if (mine !== attempt) {
          await transport.close();
          return;
        }
        set({ baudRate });
      };
      const done = pendingReopen.then(run);
      pendingReopen = done.catch(() => undefined);
      return done;
    },

    disconnect: async () => {
      attempt += 1;
      const { transport } = get();
      set({
        status: 'disconnected',
        transport: null,
        portLabel: null,
        error: null,
        reconnecting: false,
      });
      // A reopen in flight sees the bumped attempt and closes the port itself; wait for it.
      const closing = pendingReopen.then(() => transport?.close());
      pendingClose = closing;
      await closing;
    },
  };
});
