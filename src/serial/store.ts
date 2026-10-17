import { create } from 'zustand';
import { useTransportStore } from '../transport/store';
import type { Transport } from '../transport/types';
import { EMPTY_PLOT, PlotParser, type PlotSnapshot } from './plot-parser';
import { LineAssembler } from './stream';

// Serial monitor + plotter state over whichever transport is open (_config/architecture.md →
// Transports: the monitor only sees the `Transport` interface).
//
// The assembler and parser buffer every chunk as it arrives; React only sees a snapshot that
// is published at most once per animation frame, so a chatty board (10 kB/s, hundreds of
// lines a second) costs one render per frame, not one per chunk. Pausing freezes the
// published snapshot while buffering goes on; resuming publishes everything at once.

export const BAUD_STORAGE_KEY = 'som.serialBaud';
export const BAUD_RATES = [9600, 19200, 38400, 57600, 74880, 115200, 230400] as const;
export const DEFAULT_SERIAL_BAUD = 115200;

export type LineEnding = 'none' | '\n' | '\r\n';
export type SerialStatus = 'idle' | 'listening' | 'disconnected';
export type SerialErrorKey = 'UI_SERIAL_ERROR_NOT_CONNECTED' | 'UI_SERIAL_ERROR_SEND';

export interface SerialError {
  key: SerialErrorKey;
  /** Transport/browser text, shown verbatim. */
  detail?: string;
}

function isBaudRate(value: number): boolean {
  return (BAUD_RATES as readonly number[]).includes(value);
}

// Same blocked-storage handling as src/compile/store.ts.
function readStoredBaud(): number {
  try {
    const stored = Number(window.localStorage.getItem(BAUD_STORAGE_KEY));
    return isBaudRate(stored) ? stored : DEFAULT_SERIAL_BAUD;
  } catch {
    return DEFAULT_SERIAL_BAUD;
  }
}

function writeStoredBaud(baud: number): void {
  try {
    window.localStorage.setItem(BAUD_STORAGE_KEY, String(baud));
  } catch {
    // Storage blocked: the baud still applies for this session.
  }
}

const frame: (cb: () => void) => void = (cb) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cb());
  else setTimeout(cb, 16);
};

export interface SerialState {
  baud: number;
  paused: boolean;
  autoscroll: boolean;
  /** True while a flash is in progress: incoming bytes are bootloader traffic, not output. */
  muted: boolean;
  status: SerialStatus;
  error: SerialError | null;
  /** Last complete lines (bounded), oldest first. */
  lines: readonly string[];
  /** Text after the last newline. */
  partial: string;
  /** Lines completed since the last clear, counting the ones that left the buffer. */
  totalLines: number;
  series: PlotSnapshot;
  start: (transport: Transport) => Promise<void>;
  /**
   * Stops listening and keeps the buffer. `'disconnected'` leaves the unplug notice up. The
   * unfinished line is closed in the log (never parsed for the plot: it may be cut short), so
   * the next connection does not glue its first bytes onto it.
   */
  stop: (status?: 'idle' | 'disconnected') => void;
  send: (text: string, lineEnding: LineEnding) => Promise<void>;
  clear: () => void;
  setBaud: (baud: number) => Promise<void>;
  setPaused: (paused: boolean) => void;
  setAutoscroll: (autoscroll: boolean) => void;
  /** B8's flashers set this around a flash. */
  setMuted: (muted: boolean) => void;
  /** Everything buffered (also while paused) as plain text, for "download .txt". */
  exportLog: () => string;
}

const assembler = new LineAssembler();
const parser = new PlotParser();
let current: Transport | null = null;
let unsubscribe: (() => void) | null = null;
let framePending = false;
// Baud changes run one after the other, each applying the *latest* chosen baud, so a quick
// 115200 → 9600 → 115200 never ends at 9600 while the picker says 115200.
let baudChain: Promise<void> = Promise.resolve();

export const useSerialStore = create<SerialState>()((set, get) => {
  const publish = () => {
    framePending = false;
    if (get().paused) return;
    set({
      lines: assembler.lines(),
      partial: assembler.partial,
      totalLines: assembler.totalLines,
      series: parser.snapshot(),
    });
  };

  const schedule = () => {
    if (framePending) return;
    framePending = true;
    frame(publish);
  };

  const applyBaud = (): Promise<void> => {
    baudChain = baudChain.then(async () => {
      const transportStore = useTransportStore.getState();
      const { baud } = get();
      if (current && transportStore.transport === current && transportStore.baudRate !== baud) {
        await transportStore.reopen(baud);
      }
    });
    return baudChain;
  };

  const onData = (chunk: Uint8Array) => {
    if (get().muted) return;
    const now = Date.now();
    for (const line of assembler.push(chunk)) parser.push(line, now);
    schedule();
  };

  return {
    baud: readStoredBaud(),
    paused: false,
    autoscroll: true,
    muted: false,
    status: 'idle',
    error: null,
    lines: [],
    partial: '',
    totalLines: 0,
    series: EMPTY_PLOT,

    start: async (transport) => {
      if (current === transport) return;
      get().stop();
      current = transport;
      const offData = transport.onData(onData);
      const offDisconnect = transport.onDisconnect(() => {
        if (current !== transport) return;
        // Keep the buffer: what the board printed before it went away is often the clue.
        get().stop('disconnected');
      });
      unsubscribe = () => {
        offData();
        offDisconnect();
      };
      set({ status: 'listening', error: null });
      await applyBaud();
    },

    stop: (status = 'idle') => {
      const wasListening = current !== null;
      unsubscribe?.();
      unsubscribe = null;
      current = null;
      if (wasListening) {
        assembler.finish();
        schedule();
      }
      set({ status });
    },

    send: async (text, lineEnding) => {
      if (!current || !current.isOpen) {
        set({ error: { key: 'UI_SERIAL_ERROR_NOT_CONNECTED' } });
        return;
      }
      const ending = lineEnding === 'none' ? '' : lineEnding;
      try {
        await current.write(new TextEncoder().encode(text + ending));
        set({ error: null });
      } catch (error) {
        set({
          error: {
            key: 'UI_SERIAL_ERROR_SEND',
            detail: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },

    clear: () => {
      assembler.clear();
      parser.clear();
      set({ lines: [], partial: '', totalLines: 0, series: EMPTY_PLOT, error: null });
    },

    setBaud: async (baud) => {
      if (!isBaudRate(baud)) return;
      writeStoredBaud(baud);
      set({ baud });
      await applyBaud();
    },

    setPaused: (paused) => {
      set({ paused });
      if (!paused) publish();
    },

    setAutoscroll: (autoscroll) => set({ autoscroll }),

    setMuted: (muted) => set({ muted }),

    exportLog: () => {
      const lines = assembler.lines();
      const { partial } = assembler;
      return lines.join('\n') + (lines.length > 0 ? '\n' : '') + partial;
    },
  };
});
