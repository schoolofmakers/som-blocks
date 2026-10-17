import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { t, type Lang } from '../i18n/messages';
import { downloadFile, sketchName } from '../projects/archive';
import { useProjectsStore } from '../projects/store';

export const CODE_VIEW_OPEN_STORAGE_KEY = 'som.codeViewOpen';
/** Longer sketches render as plain text so typing in the editor never stalls on colouring. */
export const MAX_HIGHLIGHT_LINES = 1500;
export const COPIED_RESET_MS = 2000;
/** Tailwind's `lg` breakpoint: the code view starts open from here up. */
const DESKTOP_QUERY = '(min-width: 1024px)';

type Highlighter = (code: string) => string;

// One shared load for every CodeView; a failed load (offline before the chunk was cached)
// is retried on the next mount.
let highlighterLoad: Promise<Highlighter> | null = null;
function loadHighlighter(): Promise<Highlighter> {
  highlighterLoad ??= import('./highlight').then(
    (module) => module.highlightCpp,
    (error: unknown) => {
      highlighterLoad = null;
      throw error;
    },
  );
  return highlighterLoad;
}

// Guarded like src/compile/store.ts: blocked storage only means the choice is not remembered.
function readStoredOpen(): boolean | null {
  try {
    const value = window.localStorage.getItem(CODE_VIEW_OPEN_STORAGE_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    window.localStorage.setItem(CODE_VIEW_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Not persisted; fine.
  }
}

function initialOpen(): boolean {
  const stored = readStoredOpen();
  if (stored !== null) return stored;
  // No matchMedia (old browsers, jsdom): open, the safe side for a read-only view.
  return typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : true;
}

/**
 * Copy with the async Clipboard API, falling back to a hidden textarea + execCommand where
 * the API is missing or refused (http origins other than localhost are not secure contexts).
 * Pattern: BlocklyDuino v2/js/buttons_functions.js copyToClipboard (writeText, legacy
 * execCommand path).
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.append(area);
  area.focus();
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    previousFocus?.focus();
  }
}

/** Lines as the editor shows them: a trailing newline does not add an empty last line. */
function countLines(code: string): number {
  if (code === '') return 0;
  const lines = code.split('\n').length;
  return code.endsWith('\n') ? lines - 1 : lines;
}

interface CodeViewProps {
  code: string;
  lang: Lang;
}

/** Read-only view of the generated sketch with copy, download as `.ino` and collapse. */
export function CodeView({ code, lang }: CodeViewProps) {
  const projectName = useProjectsStore((state) => state.current?.name);
  const [open, setOpen] = useState(initialOpen);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bodyId = useId();

  useEffect(() => {
    let alive = true;
    loadHighlighter().then(
      (fn) => {
        if (alive) setHighlighter(() => fn);
      },
      () => {
        // Chunk unavailable: the plain text stays, which is the whole content anyway.
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const lineCount = countLines(code);
  const tooLong = lineCount > MAX_HIGHLIGHT_LINES;
  const html = useMemo(() => {
    if (!highlighter || tooLong || code === '') return null;
    try {
      return highlighter(code);
    } catch {
      return null;
    }
  }, [highlighter, tooLong, code]);
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'),
    [lineCount],
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeStoredOpen(next);
  };

  const copy = async () => {
    const ok = await copyText(code);
    setCopyState(ok ? 'copied' : 'failed');
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState('idle'), COPIED_RESET_MS);
  };

  const download = () => {
    const name = sketchName(projectName ?? t('UI_PROJECT_DEFAULT_NAME', lang));
    downloadFile(new TextEncoder().encode(code), `${name}.ino`, 'text/plain;charset=utf-8');
  };

  const button = 'rounded border border-border px-2 py-1 text-xs disabled:opacity-50 hover:bg-bg';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="generated-code-title" className="text-sm font-semibold text-muted">
          {t('UI_GENERATED_CODE', lang)}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={code === ''}
            title={t('UI_CODE_COPY_HINT', lang)}
            className={button}
          >
            {copyState === 'copied' ? t('UI_CODE_COPIED', lang) : t('UI_CODE_COPY', lang)}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={code === ''}
            title={t('UI_CODE_DOWNLOAD_HINT', lang)}
            className={button}
          >
            {t('UI_CODE_DOWNLOAD', lang)}
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            className={button}
          >
            {open ? t('UI_CODE_HIDE', lang) : t('UI_CODE_SHOW', lang)}
          </button>
        </div>
      </div>
      {copyState === 'failed' && (
        <p role="status" className="mb-2 text-xs text-warn">
          {t('UI_CODE_COPY_FAILED', lang)}
        </p>
      )}
      {/* Collapsed with `hidden`, not unmounted, so the sketch text stays in the DOM. */}
      <div id={bodyId} hidden={!open} className="flex min-h-0 flex-1 flex-col">
        {open && tooLong && (
          <p className="mb-2 text-xs text-muted">{t('UI_CODE_TOO_LONG_TO_COLOR', lang)}</p>
        )}
        <div className="code-view flex max-h-[70dvh] min-h-32 flex-1 overflow-auto rounded-lg border border-border bg-surface font-mono text-xs leading-5">
          <pre
            aria-hidden="true"
            data-testid="code-line-numbers"
            className="sticky left-0 shrink-0 border-r border-border bg-surface px-2 py-3 text-right text-muted select-none"
          >
            {gutter}
          </pre>
          {html === null ? (
            <pre data-testid="generated-code" className="flex-1 px-3 py-3 whitespace-pre">
              {code}
            </pre>
          ) : (
            <pre
              data-testid="generated-code"
              data-highlighted="true"
              className="flex-1 px-3 py-3 whitespace-pre"
              // highlight.js escapes the source; only its own hljs-* spans are markup.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
