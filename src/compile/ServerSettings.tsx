import { useState, type FormEvent } from 'react';
import { t, type Lang } from '../i18n/messages';
import { useCompileStore } from './store';

interface ServerSettingsProps {
  lang: Lang;
}

/** Small popover (native <details>) to point the editor at another compile server. */
export function ServerSettings({ lang }: ServerSettingsProps) {
  const serverUrl = useCompileStore((s) => s.serverUrl);
  const setServerUrl = useCompileStore((s) => s.setServerUrl);
  const [draft, setDraft] = useState(serverUrl);
  const [open, setOpen] = useState(false);

  const save = (event: FormEvent) => {
    event.preventDefault();
    setServerUrl(draft);
    setOpen(false);
  };

  const reset = () => {
    setServerUrl('');
    setDraft(useCompileStore.getState().serverUrl);
    setOpen(false);
  };

  return (
    <details
      className="relative"
      open={open}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen(isOpen);
        if (isOpen) setDraft(serverUrl);
      }}
    >
      <summary className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm">
        {t('UI_SERVER_SETTINGS', lang)}
      </summary>
      <form
        onSubmit={save}
        className="absolute right-0 z-10 mt-2 flex w-72 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('UI_SERVER_URL', lang)}
          <input
            type="url"
            required
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={reset} className="px-2 py-1 text-xs text-muted">
            {t('UI_RESET_DEFAULT', lang)}
          </button>
          <button
            type="submit"
            className="rounded bg-accent px-3 py-1 text-xs font-semibold text-bg"
          >
            {t('UI_SAVE', lang)}
          </button>
        </div>
      </form>
    </details>
  );
}
