import { lazy, Suspense, useId, useState } from 'react';
import { t, type Lang } from '../i18n/messages';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { useSerialSession } from './session';

// Bottom panel with the serial monitor and plotter tabs. Always mounted (collapsed or not) so
// the serial store listens to the board from the moment it connects; the terminal and the
// chart are lazy chunks loaded the first time their tab opens.

const SerialMonitor = lazy(() => import('./SerialMonitor'));
const SerialPlotter = lazy(() => import('./SerialPlotter'));

export type SerialTab = 'monitor' | 'plot';
export const TAB_STORAGE_KEY = 'som.serialTab';

function readStoredTab(): SerialTab {
  try {
    return window.localStorage.getItem(TAB_STORAGE_KEY) === 'plot' ? 'plot' : 'monitor';
  } catch {
    return 'monitor';
  }
}

function writeStoredTab(tab: SerialTab): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Storage blocked: the tab still applies for this session.
  }
}

interface SerialPanelProps {
  lang: Lang;
}

export function SerialPanel({ lang }: SerialPanelProps) {
  useSerialSession();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SerialTab>(readStoredTab);
  const id = useId();
  const contentId = `${id}-content`;

  const choose = (next: SerialTab) => {
    setTab(next);
    writeStoredTab(next);
    setOpen(true);
  };

  const tabClass = (active: boolean) =>
    `min-h-9 rounded-t px-3 py-1 text-sm font-semibold ${
      active ? 'border-b-2 border-accent text-accent' : 'text-muted'
    }`;

  return (
    <section
      aria-label={t('UI_SERIAL_PANEL', lang)}
      data-testid="serial-panel"
      className="border-t border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-1">
        <div role="tablist" aria-label={t('UI_SERIAL_PANEL', lang)} className="flex gap-1">
          <button
            type="button"
            role="tab"
            id={`${id}-tab-monitor`}
            aria-selected={tab === 'monitor'}
            aria-controls={contentId}
            className={tabClass(tab === 'monitor')}
            onClick={() => choose('monitor')}
          >
            {t('UI_SERIAL_TAB_MONITOR', lang)}
          </button>
          <button
            type="button"
            role="tab"
            id={`${id}-tab-plot`}
            aria-selected={tab === 'plot'}
            aria-controls={contentId}
            className={tabClass(tab === 'plot')}
            onClick={() => choose('plot')}
          >
            {t('UI_SERIAL_TAB_PLOT', lang)}
          </button>
        </div>
        <button
          type="button"
          data-testid="serial-panel-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          className="min-h-9 rounded border border-border px-2 py-1 text-xs"
          onClick={() => setOpen((value) => !value)}
        >
          {t(open ? 'UI_SERIAL_HIDE' : 'UI_SERIAL_SHOW', lang)}
        </button>
      </div>
      {open && (
        <div
          id={contentId}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab}`}
          className="h-80 px-4 pt-2 pb-3"
        >
          <PanelErrorBoundary lang={lang}>
            <Suspense
              fallback={<p className="text-sm text-muted">{t('UI_SERIAL_LOADING', lang)}</p>}
            >
              {tab === 'monitor' ? <SerialMonitor lang={lang} /> : <SerialPlotter lang={lang} />}
            </Suspense>
          </PanelErrorBoundary>
        </div>
      )}
    </section>
  );
}
