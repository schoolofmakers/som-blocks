import { useEffect, useState } from 'react';
import { BlocklyWorkspace } from './blocks/BlocklyWorkspace';
import type { ToolboxProfile } from './blocks/types';
import { BoardPicker } from './boards/BoardPicker';
import { useBoardStore } from './boards/store';
import { CodeView } from './codeview/CodeView';
import { CompileButton } from './compile/CompileButton';
import { LogPanel } from './compile/LogPanel';
import { ServerSettings } from './compile/ServerSettings';
import { UploadButton } from './flash/UploadButton';
import { SerialPanel } from './serial/SerialPanel';
import { chooseLang } from './i18n/lang';
import { LanguageSwitch } from './i18n/LanguageSwitch';
import { DEFAULT_LANG, t, type Lang } from './i18n/messages';
import { ProjectNotice, ProjectsMenu } from './projects/ProjectsMenu';
import { useProjectsStore } from './projects/store';
import { SerialPanel } from './serial/SerialPanel';
import { ConnectButton } from './transport/ConnectScreen';

interface AppProps {
  /** Language at startup (src/main.tsx resolves it); the header switch changes it live. */
  lang?: Lang;
  toolboxProfile?: ToolboxProfile;
}

export function App({ lang: initialLang = DEFAULT_LANG, toolboxProfile = 'starter' }: AppProps) {
  const [lang, setLang] = useState(initialLang);
  const [code, setCode] = useState('');
  const boardId = useBoardStore((state) => state.boardId);
  const editorLoad = useProjectsStore((state) => state.editorLoad);
  const saveWorkspace = useProjectsStore((state) => state.saveWorkspace);
  const workspaceLoadFailed = useProjectsStore((state) => state.workspaceLoadFailed);

  // New projects are named in the current language, including after a switch. Then open the
  // last project (or create the first one); init() only loads once per page.
  useEffect(() => {
    const projects = useProjectsStore.getState();
    projects.setDefaultName(t('UI_PROJECT_DEFAULT_NAME', lang));
    void projects.init();
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('UI_APP_TITLE', lang);
  }, [lang]);

  // Every string re-renders from `lang`; BlocklyWorkspace relabels its toolbox and blocks in
  // place on a `lang` change (applyLocale), keeping blocks, undo history and zoom.
  const changeLang = (next: Lang) => {
    chooseLang(next);
    setLang(next);
  };

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
          <UploadButton lang={lang} code={code} boardId={boardId} />
          <ConnectButton lang={lang} />
          <LanguageSwitch lang={lang} onChange={changeLang} />
        </div>
      </header>
      <ProjectNotice lang={lang} />
      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        {/* Mounted once the first project is open, so nothing typed before IndexedDB
            answers can be dropped or replaced by the project load. */}
        {editorLoad ? (
          <BlocklyWorkspace
            lang={lang}
            toolboxProfile={toolboxProfile}
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
      <SerialPanel lang={lang} />
      <footer className="border-t border-border px-4 py-2 text-xs text-muted">
        {t('UI_FOOTER', lang)}
      </footer>
    </div>
  );
}
