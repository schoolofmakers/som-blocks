import { useEffect, useRef, useState } from 'react';
import { useFlashStore } from '../flash/store';
import { t, type Lang } from '../i18n/messages';
import { statusLine, stripAnsi } from './status';
import { useCompileStore } from './store';

interface LogPanelProps {
  lang: Lang;
}

/**
 * Status line + arduino-cli output, verbatim (_config/standards.md: never hide compiler
 * errors), followed by the upload log. The log is a React text child, so `<`/`>` in gcc messages render as typed.
 */
export function LogPanel({ lang }: LogPanelProps) {
  const status = useCompileStore((s) => s.status);
  const compileLog = stripAnsi(useCompileStore((s) => s.log));
  // Upload output (B8) follows the compiler output in the same panel.
  const flashLog = useFlashStore((s) => s.log);
  const log =
    flashLog.length === 0
      ? compileLog
      : `${compileLog}${compileLog === '' || compileLog.endsWith('\n') ? '' : '\n'}${flashLog.join('\n')}`;
  const result = useCompileStore((s) => s.result);
  const error = useCompileStore((s) => s.error);
  const durationMs = useCompileStore((s) => s.durationMs);
  const requestUrl = useCompileStore((s) => s.requestUrl);
  const ota = useCompileStore((s) => s.ota);
  const logRef = useRef<HTMLPreElement>(null);
  // Remember *which* log was copied, so a new compile resets the button by itself.
  const [copiedLog, setCopiedLog] = useState<string | null>(null);
  const copied = log !== '' && copiedLog === log;

  // Keep the end of the output (where gcc puts the summary) in view.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopiedLog(log);
    } catch {
      // Clipboard blocked (permissions, insecure context): the text is still selectable.
    }
  };

  const tone = status === 'error' ? 'text-danger' : status === 'ok' ? 'text-ok' : 'text-muted';

  return (
    <section aria-labelledby="compile-log-title" className="mt-4 flex flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="compile-log-title" className="text-sm font-semibold text-muted">
          {t('UI_COMPILE_OUTPUT', lang)}
        </h2>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={log === ''}
          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
        >
          {copied ? t('UI_COPIED', lang) : t('UI_COPY_LOG', lang)}
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        data-testid="compile-status"
        className={`mb-2 text-sm ${tone}`}
      >
        {statusLine({ status, result, error, durationMs, requestUrl, ota }, lang)}
      </p>
      <pre
        ref={logRef}
        data-testid="compile-log"
        className="max-h-64 min-h-16 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs whitespace-pre"
      >
        {log}
      </pre>
    </section>
  );
}
