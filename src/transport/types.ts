// The one seam between the editor and a board (_config/architecture.md → Transports).
// Flashers (B8) and the serial monitor (B9) only ever see this interface; the USB
// implementation is `WebSerialTransport`, the WiFi one is `RelayTransport` (Track D).

export type TransportKind = 'web-serial' | 'relay';

export interface SerialSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
}

export interface Transport {
  readonly kind: TransportKind;
  readonly isOpen: boolean;
  open(opts: { baudRate: number }): Promise<void>;
  /** Releases every lock and the port. Safe to call twice, after a disconnect, or on error. */
  close(): Promise<void>;
  /** Writes are queued: a second write starts only after the first one settled. */
  write(data: Uint8Array): Promise<void>;
  /** Returns an unsubscribe function. */
  onData(cb: (chunk: Uint8Array) => void): () => void;
  /** Fires once when the device goes away (unplugged, or the port died under the reader). */
  onDisconnect(cb: () => void): () => void;
  /** DTR/RTS lines, used by flashers to reset a board into its bootloader. */
  setSignals?(signals: SerialSignals): Promise<void>;
  /**
   * The underlying `SerialPort` when `kind === 'web-serial'`. esptool-js (B8) wants the raw
   * port and opens it itself, so a flasher must `close()` this transport before handing it on.
   */
  readonly nativePort?: unknown;
}

/** Every failure a transport reports; the UI maps each code to an i18n message. */
export type TransportErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'blocked'
  | 'open-failed'
  | 'not-open'
  | 'write-failed'
  | 'disconnected'
  /** WiFi: the relay refused the pairing token (the board made a new one: pair again). */
  | 'unauthorized'
  /** WiFi: the relay could not be reached (offline, wrong address, blocked). */
  | 'unreachable';

export class TransportError extends Error {
  readonly code: TransportErrorCode;
  readonly detail?: string;

  constructor(code: TransportErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TransportError';
    this.code = code;
    this.detail = detail;
  }
}
