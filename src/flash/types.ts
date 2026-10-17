import type { BoardDefinition } from '../boards/types';
import type { CompileResult } from '../compile/types';
import type { Transport } from '../transport/types';

// The one seam between the upload orchestration (store.ts) and the board-specific flashers
// (esptool.ts, avrgirl.ts, relay-ota.ts). A flasher gets a compiled result, the board it is for and the
// connected transport; it reports progress and log lines and throws `FlashError` on failure.

export type FlashPhase = 'connect' | 'erase' | 'write' | 'verify' | 'reset' | 'done';

export interface FlashProgress {
  phase: FlashPhase;
  /** 0–100 for the phase that reports it (write: all images together). */
  percent: number;
  message?: string;
}

export interface FlashHooks {
  onProgress(progress: FlashProgress): void;
  /** One raw line of tool output (esptool-js terminal, avrgirl debug), for the log panel. */
  onLog(line: string): void;
  signal?: AbortSignal;
}

export interface Flasher {
  /**
   * Whether `signal` can stop a flash midway. esptool-js checks it between write blocks;
   * avrgirl has no hook to stop stk500 once it started, so the UI hides Cancel for it.
   */
  readonly supportsCancel: boolean;
  /**
   * Flashes `result` to the board behind `transport`. The flasher takes the raw port, so it
   * closes `transport` first; reopening it afterwards is the caller's job (store.ts), so a
   * failure anywhere still gives the port back.
   */
  flash(
    result: CompileResult,
    board: BoardDefinition,
    transport: Transport,
    hooks: FlashHooks,
  ): Promise<void>;
}

export type FlashErrorCode =
  | 'wrong-chip'
  | 'no-port'
  | 'sync-failed'
  | 'write-failed'
  | 'verify-failed'
  | 'cancelled'
  | 'unsupported-board'
  | 'transport'
  /** WiFi (relay OTA): the board reported `failed`; `detail` is its reason. */
  | 'ota-failed'
  /** WiFi: the relay lost the build twice (restart/expiry) while the board was online. */
  | 'ota-lost'
  /** WiFi: no `running` or `failed` within the upload deadline. */
  | 'ota-timeout'
  /** WiFi: the relay does not know the board (off, or not on WiFi). */
  | 'ota-offline'
  /** WiFi: the relay refused the pairing token (pair again). */
  | 'ota-unauthorized'
  /** WiFi: the app image is over the relay's 2 MB limit. */
  | 'ota-too-big'
  /** WiFi: the project is not flagged "sube por WiFi", so the sketch has no SomLink. */
  | 'ota-not-flagged';

export class FlashError extends Error {
  readonly code: FlashErrorCode;
  /** The tool's own error text, shown verbatim in the log panel (never swallowed). */
  readonly detail?: string;

  constructor(code: FlashErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FlashError';
    this.code = code;
    this.detail = detail;
  }
}

/** Duck-typed: libraries reject with strings, DOMExceptions and Errors alike. */
export function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new FlashError('cancelled');
}
