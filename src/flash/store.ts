import { create } from 'zustand';
import { getBoard } from '../boards/registry';
import { fullFqbn, type BoardDefinition } from '../boards/types';
import { sketchRequest } from '../compile/client';
import { useCompileStore } from '../compile/store';
import type { CompileRequest, CompileResult } from '../compile/types';
import type { MessageKey } from '../i18n/messages';
import { DEFAULT_BAUD_RATE, useTransportStore } from '../transport/store';
import type { Transport } from '../transport/types';
import { selectFlasher } from './select';
import { errorText, FlashError, type FlashErrorCode, type FlashPhase } from './types';

// Upload orchestration: a compiled result for exactly the current sketch and board, a
// connected port, then the board's flasher. The port is lent to the flasher (closed here,
// reopened in `finally`), and `isFlashing` tells everyone else (the serial monitor, B9) to keep
// their hands off it meanwhile.

export type UploadStatus = 'idle' | 'compiling' | 'flashing' | 'done' | 'error';

export interface UploadError {
  key: MessageKey;
  /** Tool error text; the same text also goes to the log panel verbatim. */
  detail?: string;
}

export interface UploadInput {
  code: string;
  boardId: string;
}

interface FlashState {
  status: UploadStatus;
  /** True while a flasher owns the port. Readers of the transport must stay away. */
  isFlashing: boolean;
  /** Whether the running flasher honours Cancel (avrgirl does not). */
  canCancel: boolean;
  phase: FlashPhase | null;
  percent: number;
  /** Flasher output, one line each, shown after the compiler output. */
  log: string[];
  error: UploadError | null;
  upload: (input: UploadInput) => Promise<void>;
  cancel: () => void;
}

const ERROR_KEYS: Record<Exclude<FlashErrorCode, 'sync-failed'>, MessageKey> = {
  'wrong-chip': 'UI_UPLOAD_ERR_WRONG_CHIP',
  'no-port': 'UI_UPLOAD_ERR_NO_PORT',
  'write-failed': 'UI_UPLOAD_ERR_WRITE',
  'verify-failed': 'UI_UPLOAD_ERR_VERIFY',
  cancelled: 'UI_UPLOAD_ERR_CANCELLED',
  'unsupported-board': 'UI_UPLOAD_ERR_UNSUPPORTED',
  transport: 'UI_UPLOAD_ERR_TRANSPORT',
};

/** The student-facing message; a failed ESP sync gets the BOOT + RESET hint. */
export function uploadErrorKey(code: FlashErrorCode, board: Pick<BoardDefinition, 'upload'>) {
  if (code === 'sync-failed') {
    return board.upload.tool === 'esptool' ? 'UI_UPLOAD_ERR_SYNC_ESP' : 'UI_UPLOAD_ERR_SYNC_AVR';
  }
  return ERROR_KEYS[code];
}

function sameRequest(a: CompileRequest | null, b: CompileRequest): boolean {
  return (
    a !== null &&
    a.fqbn === b.fqbn &&
    a.files.length === b.files.length &&
    a.files.every(
      (file, i) => file.name === b.files[i]?.name && file.content === b.files[i]?.content,
    )
  );
}

export const REOPEN_ATTEMPTS = 5;
export const REOPEN_DELAY_MS = 300;

/**
 * Gives the port back after a flash. The board is rebooting (and a native-USB C3 may
 * re-enumerate) and avrgirl closes its port without awaiting it, so the first open can fail:
 * retry a few times before giving up.
 */
export async function reopenTransport(
  transport: Transport,
  attempts = REOPEN_ATTEMPTS,
  delayMs = REOPEN_DELAY_MS,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (transport.isOpen) return true;
    try {
      await transport.open({ baudRate: DEFAULT_BAUD_RATE });
      return true;
    } catch {
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return transport.isOpen;
}

let controller: AbortController | null = null;

export const useFlashStore = create<FlashState>()((set, get) => {
  const appendLog = (line: string) => set((state) => ({ log: [...state.log, line] }));
  const fail = (error: UploadError) => {
    if (error.detail) appendLog(error.detail);
    set({ status: 'error', error });
  };

  /** The compile result for exactly this sketch and board, compiling first if needed. */
  const currentResult = async (request: CompileRequest): Promise<CompileResult | null> => {
    const compiled = useCompileStore.getState();
    if (compiled.status === 'ok' && compiled.result && sameRequest(compiled.request, request)) {
      return compiled.result;
    }
    set({ status: 'compiling' });
    await compiled.run(request);
    const after = useCompileStore.getState();
    return after.status === 'ok' && sameRequest(after.request, request) ? after.result : null;
  };

  return {
    status: 'idle',
    isFlashing: false,
    canCancel: false,
    phase: null,
    percent: 0,
    log: [],
    error: null,

    upload: async ({ code, boardId }) => {
      const { status } = get();
      if (status === 'compiling' || status === 'flashing') return;
      set({ status: 'idle', phase: null, percent: 0, log: [], error: null });
      const board = getBoard(boardId);

      let flasher;
      try {
        flasher = selectFlasher(board);
      } catch (error) {
        fail({ key: 'UI_UPLOAD_ERR_UNSUPPORTED', detail: errorText(error) });
        return;
      }

      const result = await currentResult(sketchRequest(code, fullFqbn(board)));
      if (!result) {
        fail({ key: 'UI_UPLOAD_ERR_COMPILE' });
        return;
      }

      const { transport, status: link } = useTransportStore.getState();
      if (link !== 'connected' || !transport) {
        fail({ key: 'UI_UPLOAD_ERR_NO_PORT' });
        return;
      }

      const mine = new AbortController();
      controller = mine;
      set({
        status: 'flashing',
        isFlashing: true,
        canCancel: flasher.supportsCancel,
        phase: 'connect',
        percent: 0,
      });
      try {
        // Release the port before the flasher takes it (the flashers close it too; it is
        // idempotent). Readers like the serial monitor see `isFlashing` and stay away.
        await transport.close();
        await flasher.flash(result, board, transport, {
          onProgress: ({ phase, percent }) => set({ phase, percent }),
          onLog: appendLog,
          signal: mine.signal,
        });
        set({ status: 'done', phase: 'done', percent: 100 });
      } catch (error) {
        const flashError =
          error instanceof FlashError ? error : new FlashError('write-failed', errorText(error));
        fail({
          key: uploadErrorKey(flashError.code, board),
          detail: flashError.detail ?? flashError.message,
        });
      } finally {
        if (controller === mine) controller = null;
        set({ canCancel: false });
        // Never leave the port closed behind the connect screen's back: reopen it, or tell the
        // transport store it is gone so the header shows "Conectar" again.
        if (!(await reopenTransport(transport))) {
          appendLog('port did not reopen after the upload; connect again');
          if (useTransportStore.getState().transport === transport) {
            await useTransportStore.getState().disconnect();
          }
        }
        set({ isFlashing: false });
      }
    },

    cancel: () => {
      controller?.abort();
    },
  };
});
