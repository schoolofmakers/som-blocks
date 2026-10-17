import { useRef, useState, type FormEvent } from 'react';
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
  // The <details> element owns its open state. Mirroring it in React state via `onToggle`
  // raced: `toggle` is dispatched as a later task, and input events (typing, Save) can be
  // handled before it. Save's `setOpen(false)` was then a no-op (the state was still
  // false), the element stayed open, and the late `toggle` set the state to open.
  // Read and close the element directly instead.
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    setServerUrl(draft);
    close();
  };

  const reset = () => {
    setServerUrl('');
    setDraft(useCompileStore.getState().serverUrl);
    close();
  };

  return (
    <details ref={detailsRef} className="relative">
      {/* The draft resets on the click that opens the popover (the element is still closed
          while its click handlers run), never on the later `toggle` event. */}
      <summary
        onClick={() => {
          if (!detailsRef.current?.open) setDraft(serverUrl);
        }}
        className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm"
      >
        {t('UI_SERVER_SETTINGS', lang)}
      </summary>
      {/* Left-anchored on phones, where the wrapped header puts the controls at the left
          edge; right-anchored once the header fits on one line. */}
      <form
        onSubmit={save}
        className="absolute left-0 sm:right-0 sm:left-auto z-10 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
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
