import { DEFAULT_LANG, t, type Lang } from './i18n/messages';

interface AppProps {
  lang?: Lang;
}

export function App({ lang = DEFAULT_LANG }: AppProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="border-b border-border bg-surface px-4 py-3">
        <h1 className="text-xl font-bold text-accent">{t('UI_APP_TITLE', lang)}</h1>
        <p className="text-sm text-muted">{t('UI_TAGLINE', lang)}</p>
      </header>
      <main className="flex flex-1 p-4">
        {/* B2 mounts the Blockly workspace here. */}
        <div
          data-testid="workspace-placeholder"
          className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border text-muted"
        >
          {t('UI_WORKSPACE_PLACEHOLDER', lang)}
        </div>
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted">
        {t('UI_FOOTER', lang)}
      </footer>
    </div>
  );
}
