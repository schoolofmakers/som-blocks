import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t, type Lang, type MessageKey } from '../i18n/messages';
import { useTransportStore } from '../transport/store';
import { BAUD_RATES, useSerialStore, type LineEnding, type SerialState } from './store';
import { DEFAULT_MAX_LINES } from './stream';
import { terminalUpdate, type Shown } from './terminal-text';

// Serial monitor: an xterm.js (MIT) terminal fed from the serial store, plus its toolbar.
// Lazy-loaded by SerialPanel, so xterm is its own chunk.
//
// Pattern: NousResearch/hermes-agent apps/desktop/src/app/right-sidebar/terminal/
// use-agent-terminal.ts — a write-only xterm (`disableStdin`) created once in an effect, a
// FitAddon that only fits when the host has a size, and `term.dispose()` in the cleanup.
// Differences: we refit from a ResizeObserver on the host (the panel resizes with the window
// and the tab switch), and the terminal subscribes to the zustand store outside React, so
// incoming text never re-renders the toolbar.

const ENDINGS: { value: LineEnding; key: MessageKey }[] = [
  { value: '\n', key: 'UI_SERIAL_ENDING_LF' },
  { value: '\r\n', key: 'UI_SERIAL_ENDING_CRLF' },
  { value: 'none', key: 'UI_SERIAL_ENDING_NONE' },
];

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function terminalTheme(): ITheme {
  const background = cssVar('--som-term-bg', '#0b1120');
  return {
    background,
    foreground: cssVar('--som-term-fg', '#e2e8f0'),
    cursor: background,
    cursorAccent: background,
    selectionBackground: cssVar('--som-term-selection', '#334155'),
  };
}

function logFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `serial-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
}

function downloadLog(): void {
  const blob = new Blob([useSerialStore.getState().exportLog()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = logFileName();
  link.click();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface SerialMonitorProps {
  lang: Lang;
}

export default function SerialMonitor({ lang }: SerialMonitorProps) {
  const connected = useTransportStore((s) => s.status === 'connected');
  const status = useSerialStore((s) => s.status);
  const baud = useSerialStore((s) => s.baud);
  const paused = useSerialStore((s) => s.paused);
  const autoscroll = useSerialStore((s) => s.autoscroll);
  const muted = useSerialStore((s) => s.muted);
  const error = useSerialStore((s) => s.error);
  const [ending, setEnding] = useState<LineEnding>('\n');
  const [draft, setDraft] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      scrollback: DEFAULT_MAX_LINES,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const refit = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // Mid-layout; the next resize tick fits again.
      }
    };
    refit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : null;
    observer?.observe(host);

    let shown: Shown = { total: 0, partial: '' };
    const render = (state: SerialState) => {
      const update = terminalUpdate(
        shown,
        { lines: state.lines, totalLines: state.totalLines, partial: state.partial },
        term.cols,
      );
      shown = { total: state.totalLines, partial: state.partial };
      if (update.reset) term.reset();
      if (update.text === '' && !update.reset) return;
      if (state.autoscroll) {
        term.write(update.text, () => term.scrollToBottom());
      } else {
        // Keep the reader's place while new lines arrive below.
        const line = term.buffer.active.viewportY;
        term.write(update.text, () => term.scrollToLine(line));
      }
    };
    render(useSerialStore.getState());
    const unsubscribe = useSerialStore.subscribe((state, previous) => {
      if (
        state.lines !== previous.lines ||
        state.partial !== previous.partial ||
        state.totalLines !== previous.totalLines
      ) {
        render(state);
      }
    });

    return () => {
      unsubscribe();
      observer?.disconnect();
      term.dispose();
    };
  }, []);

  const send = (event: FormEvent) => {
    event.preventDefault();
    void useSerialStore.getState().send(draft, ending);
    setDraft('');
  };

  const listening = status === 'listening';
  const notice: MessageKey | null = muted
    ? 'UI_SERIAL_MUTED'
    : status === 'disconnected'
      ? 'UI_SERIAL_DISCONNECTED'
      : !connected && !listening
        ? 'UI_SERIAL_CONNECT_FIRST'
        : paused
          ? 'UI_SERIAL_PAUSED'
          : null;

  const control = 'min-h-9 rounded border border-border bg-bg px-2 py-1 text-xs text-fg';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" data-testid="serial-toolbar">
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('UI_SERIAL_BAUD', lang)}
          <select
            className={control}
            value={baud}
            onChange={(e) => void useSerialStore.getState().setBaud(Number(e.target.value))}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={control}
          aria-pressed={paused}
          onClick={() => useSerialStore.getState().setPaused(!paused)}
        >
          {t(paused ? 'UI_SERIAL_RESUME' : 'UI_SERIAL_PAUSE', lang)}
        </button>
        <button type="button" className={control} onClick={() => useSerialStore.getState().clear()}>
          {t('UI_SERIAL_CLEAR', lang)}
        </button>
        <label className="flex items-center gap-1 text-xs text-fg">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => useSerialStore.getState().setAutoscroll(e.target.checked)}
          />
          {t('UI_SERIAL_AUTOSCROLL', lang)}
        </label>
        <button type="button" className={control} onClick={downloadLog}>
          {t('UI_SERIAL_DOWNLOAD', lang)}
        </button>
      </div>
      {notice && (
        <p role="status" data-testid="serial-notice" className="text-xs text-warn">
          {t(notice, lang)}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="serial-error" className="text-xs text-danger">
          {t(error.key, lang)}
          {error.detail ? ` (${error.detail})` : ''}
        </p>
      )}
      <div
        ref={hostRef}
        role="log"
        aria-label={t('UI_SERIAL_TERMINAL', lang)}
        data-testid="serial-terminal"
        className="min-h-24 flex-1 overflow-hidden rounded-lg bg-[var(--som-term-bg)] p-1"
      />
      <form className="flex flex-wrap items-center gap-2" onSubmit={send}>
        <input
          type="text"
          className={`${control} min-w-40 flex-1`}
          aria-label={t('UI_SERIAL_INPUT', lang)}
          placeholder={t('UI_SERIAL_INPUT', lang)}
          value={draft}
          disabled={!listening}
          onChange={(e) => setDraft(e.target.value)}
        />
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('UI_SERIAL_LINE_ENDING', lang)}
          <select
            className={control}
            value={ending}
            onChange={(e) => setEnding(e.target.value as LineEnding)}
          >
            {ENDINGS.map(({ value, key }) => (
              <option key={key} value={value}>
                {t(key, lang)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={control} disabled={!listening}>
          {t('UI_SERIAL_SEND', lang)}
        </button>
      </form>
    </div>
  );
}
