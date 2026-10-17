import { useRef, useState, type KeyboardEvent } from 'react';
import { DEFAULT_BOARD_ID, getBoard } from '../boards/registry';
import { format, t, type Lang, type MessageKey } from '../i18n/messages';
import { relativeTime } from './relative-time';
import { MAX_RECENT_PROJECTS, useProjectsStore, type ProjectNotice as Notice } from './store';

const menuButton =
  'min-h-11 rounded-md px-3 py-2 text-left text-sm hover:bg-bg disabled:opacity-50 sm:min-h-9';

interface ProjectsMenuProps {
  lang: Lang;
}

/** Header control: the open project's name (edit to rename) and the projects menu. */
export function ProjectsMenu({ lang }: ProjectsMenuProps) {
  const current = useProjectsStore((s) => s.current);
  const projects = useProjectsStore((s) => s.projects);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const store = useProjectsStore.getState;

  const commitName = () => {
    if (current && draft !== null) void store().rename(current.id, draft);
    setDraft(null);
  };

  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      const input = event.currentTarget;
      setDraft(null);
      // Blur after the reset has rendered, so the blur commit sees no draft.
      requestAnimationFrame(() => input.blur());
    }
  };

  const run = (action: () => Promise<unknown>) => {
    setOpen(false);
    void action();
  };

  const confirmDelete = () => {
    if (!current) return;
    const message = format(t('UI_PROJECT_DELETE_CONFIRM', lang), { name: current.name });
    if (window.confirm(message)) run(() => store().remove(current.id));
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="text"
        data-testid="project-name"
        aria-label={t('UI_PROJECT_NAME', lang)}
        value={draft ?? current?.name ?? ''}
        disabled={!current}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={onNameKey}
        className="min-h-11 w-44 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-fg hover:border-border focus:border-border focus:bg-bg"
      />
      <details
        className="relative"
        open={open}
        onToggle={(e) => {
          const isOpen = e.currentTarget.open;
          setOpen(isOpen);
          if (isOpen) setNow(Date.now());
        }}
      >
        <summary className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm">
          {t('UI_PROJECTS', lang)}
        </summary>
        {/* Right-anchored: the name field always sits to its left, so the menu has room
            to open leftwards even on a 360 px phone. */}
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={menuButton}
            onClick={() => run(() => store().create(t('UI_PROJECT_DEFAULT_NAME', lang)))}
          >
            {t('UI_PROJECT_NEW', lang)}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuButton}
            disabled={!current}
            onClick={() => current && run(() => store().duplicate(current.id))}
          >
            {t('UI_PROJECT_DUPLICATE', lang)}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuButton}
            disabled={!current}
            onClick={() => current && run(() => store().exportZip(current.id))}
          >
            {t('UI_PROJECT_EXPORT', lang)}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuButton}
            onClick={() => fileInput.current?.click()}
          >
            {t('UI_PROJECT_IMPORT', lang)}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            data-testid="project-import-input"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) run(() => store().importFile(file));
            }}
          />
          <button
            type="button"
            role="menuitem"
            className={`${menuButton} text-danger`}
            disabled={!current}
            onClick={confirmDelete}
          >
            {t('UI_PROJECT_DELETE', lang)}
          </button>
          {projects.length > 0 && (
            <>
              <p className="mt-2 border-t border-border px-3 pt-2 text-xs font-semibold text-muted">
                {t('UI_PROJECT_RECENT', lang)}
              </p>
              <ul className="flex max-h-72 flex-col overflow-auto" data-testid="recent-projects">
                {projects.slice(0, MAX_RECENT_PROJECTS).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="menuitem"
                      aria-current={p.id === current?.id ? 'true' : undefined}
                      className={`${menuButton} flex w-full flex-col ${p.id === current?.id ? 'font-semibold' : ''}`}
                      onClick={() => run(() => store().open(p.id))}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs font-normal text-muted">
                        {format(t('UI_PROJECT_UPDATED', lang), {
                          when: relativeTime(p.updatedAt, now, lang),
                        })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>
    </div>
  );
}

const IMPORT_ERROR_KEYS: Record<string, MessageKey> = {
  'too-big': 'UI_PROJECT_IMPORT_TOO_BIG',
  unreadable: 'UI_PROJECT_IMPORT_UNREADABLE',
  'not-a-project': 'UI_PROJECT_IMPORT_NOT_PROJECT',
};

function noticeText(notice: Notice, lang: Lang): string {
  switch (notice.kind) {
    case 'corrupt':
      return format(t('UI_PROJECT_CORRUPT', lang), { name: notice.name });
    case 'unknown-board':
      return format(t('UI_PROJECT_UNKNOWN_BOARD', lang), {
        name: notice.name,
        board: notice.boardId,
        fallback: getBoard(DEFAULT_BOARD_ID).name,
      });
    case 'import-failed':
      return t(IMPORT_ERROR_KEYS[notice.code] ?? 'UI_PROJECT_IMPORT_UNREADABLE', lang);
    case 'save-failed':
      return t('UI_PROJECT_SAVE_FAILED', lang);
    case 'export-failed':
      return t('UI_PROJECT_EXPORT_FAILED', lang);
  }
}

/** Project messages under the header: storage unavailable, import/open problems. */
export function ProjectNotice({ lang }: ProjectsMenuProps) {
  const memoryOnly = useProjectsStore((s) => s.status === 'ready' && s.storage === 'memory');
  const notice = useProjectsStore((s) => s.notice);
  const dismiss = useProjectsStore((s) => s.dismissNotice);
  if (!memoryOnly && !notice) return null;

  return (
    <div role="status" className="flex flex-col gap-1 px-4 pt-3 text-sm">
      {memoryOnly && (
        <p
          data-testid="projects-memory-only"
          className="rounded-md border border-danger bg-surface px-3 py-2 text-danger"
        >
          {t('UI_PROJECT_MEMORY_ONLY', lang)}
        </p>
      )}
      {notice && (
        <p
          data-testid="project-notice"
          className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2"
        >
          <span>{noticeText(notice, lang)}</span>
          <button type="button" onClick={dismiss} className="shrink-0 text-xs text-muted underline">
            {t('UI_DISMISS', lang)}
          </button>
        </p>
      )}
    </div>
  );
}
