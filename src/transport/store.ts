import { create } from 'zustand';
import { getBoard } from '../boards/registry';
import type { MessageKey } from '../i18n/messages';
import { portLabel } from './port-label';
import { TransportError, type Transport, type TransportErrorCode } from './types';
import { requestPort, WebSerialTransport, type SerialPortLike } from './web-serial';

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
  connect: (boardId: string, options?: ConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
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

export const useTransportStore = create<TransportState>()((set, get) => ({
  status: 'disconnected',
  portLabel: null,
  error: null,
  transport: null,

  connect: async (boardId, options = {}) => {
    if (get().status === 'connecting') return;
    const board = getBoard(boardId);
    // Nothing may be awaited before requestPort: the chooser needs the click's user activation.
    const pendingPort = options.port
      ? Promise.resolve(options.port)
      : requestPort(options.anyPort ? [] : board.usbFilters);
    const mine = ++attempt;
    const previous = get().transport;
    set({ status: 'connecting', error: null });

    let transport: WebSerialTransport | undefined;
    try {
      const port = await pendingPort;
      await pendingClose;
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
    const opened = transport;
    opened.onDisconnect(() => {
      if (get().transport !== opened) return;
      set({
        status: 'error',
        error: { key: 'UI_CONNECT_ERROR_DISCONNECTED' },
        transport: null,
        portLabel: null,
      });
    });
    set({
      status: 'connected',
      transport: opened,
      portLabel: portLabel(opened.nativePort.getInfo(), boardId),
      error: null,
    });
  },

  disconnect: async () => {
    attempt += 1;
    const { transport } = get();
    set({ status: 'disconnected', transport: null, portLabel: null, error: null });
    const closing = transport?.close() ?? Promise.resolve();
    pendingClose = closing;
    await closing;
  },
}));
