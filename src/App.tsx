import { useState } from 'react';
import { BlocklyWorkspace } from './blocks/BlocklyWorkspace';
import { BoardPicker } from './boards/BoardPicker';
import { useBoardStore } from './boards/store';
import { CompileButton } from './compile/CompileButton';
import { LogPanel } from './compile/LogPanel';
import { ServerSettings } from './compile/ServerSettings';
import { DEFAULT_LANG, t, type Lang } from './i18n/messages';

interface AppProps {
  lang?: Lang;
}

export function App({ lang = DEFAULT_LANG }: AppProps) {
  const [code, setCode] = useState('');
  const boardId = useBoardStore((state) => state.boardId);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div>
          <h1 className="text-xl font-bold text-accent">{t('UI_APP_TITLE', lang)}</h1>
          <p className="text-sm text-muted">{t('UI_TAGLINE', lang)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoardPicker lang={lang} />
          <ServerSettings lang={lang} />
          <CompileButton lang={lang} code={code} boardId={boardId} />
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <BlocklyWorkspace lang={lang} onCodeChange={setCode} boardId={boardId} />
        {/* Minimal read-only preview; the real code view (copy/download) is B12. */}
        <section aria-labelledby="generated-code-title" className="flex flex-col lg:w-96">
          <h2 id="generated-code-title" className="mb-2 text-sm font-semibold text-muted">
            {t('UI_GENERATED_CODE', lang)}
          </h2>
          <pre
            data-testid="generated-code"
            className="flex-1 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs"
          >
            {code}
          </pre>
          <LogPanel lang={lang} />
        </section>
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted">
        {t('UI_FOOTER', lang)}
      </footer>
    </div>
  );
}
