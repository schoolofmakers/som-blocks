import { useEffect, useState } from 'react';
import { BlocklyWorkspace } from './blocks/BlocklyWorkspace';
import { BoardPicker } from './boards/BoardPicker';
import { useBoardStore } from './boards/store';
import { CodeView } from './codeview/CodeView';
import { CompileButton } from './compile/CompileButton';
import { LogPanel } from './compile/LogPanel';
import { ServerSettings } from './compile/ServerSettings';
import { DEFAULT_LANG, t, type Lang } from './i18n/messages';
import { ProjectNotice, ProjectsMenu } from './projects/ProjectsMenu';
import { useProjectsStore } from './projects/store';
import { ConnectButton } from './transport/ConnectScreen';

interface AppProps {
  lang?: Lang;
}

export function App({ lang = DEFAULT_LANG }: AppProps) {
  const [code, setCode] = useState('');
  const boardId = useBoardStore((state) => state.boardId);
  const editorLoad = useProjectsStore((state) => state.editorLoad);
  const saveWorkspace = useProjectsStore((state) => state.saveWorkspace);
  const workspaceLoadFailed = useProjectsStore((state) => state.workspaceLoadFailed);

  // Open the last project (or create the first one). init() runs once per page.
  useEffect(() => {
    void useProjectsStore.getState().init({ defaultName: t('UI_PROJECT_DEFAULT_NAME', lang) });
  }, [lang]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div>
          <h1 className="text-xl font-bold text-accent">{t('UI_APP_TITLE', lang)}</h1>
          <p className="text-sm text-muted">{t('UI_TAGLINE', lang)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectsMenu lang={lang} />
          <BoardPicker lang={lang} />
          <ServerSettings lang={lang} />
          <CompileButton lang={lang} code={code} boardId={boardId} />
          <ConnectButton lang={lang} />
        </div>
      </header>
      <ProjectNotice lang={lang} />
      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        {/* Mounted once the first project is open, so nothing typed before IndexedDB
            answers can be dropped or replaced by the project load. */}
        {editorLoad ? (
          <BlocklyWorkspace
            lang={lang}
            onCodeChange={setCode}
            boardId={boardId}
            load={editorLoad}
            onWorkspaceChange={saveWorkspace}
            onLoadError={() => void workspaceLoadFailed()}
          />
        ) : (
          <div
            aria-busy="true"
            className="min-h-[60dvh] flex-1 rounded-lg border border-border bg-surface"
          />
        )}
        <section aria-labelledby="generated-code-title" className="flex flex-col lg:w-96">
          <CodeView code={code} lang={lang} />
          <LogPanel lang={lang} />
        </section>
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted">
        {t('UI_FOOTER', lang)}
      </footer>
    </div>
  );
}
