import { getBoard } from '../boards/registry';
import { fullFqbn } from '../boards/types';
import { t, type Lang } from '../i18n/messages';
import { sketchRequest } from './client';
import { useCompileStore } from './store';

interface CompileButtonProps {
  lang: Lang;
  /** The sketch the generator produced for the current workspace. */
  code: string;
  /** Selected board (B5 registry); its full fqbn, options included, goes to the server. */
  boardId: string;
  /** "Sube por WiFi" project: compile with the board's OTA options. */
  ota?: boolean;
}

export function CompileButton({ lang, code, boardId, ota = false }: CompileButtonProps) {
  const compiling = useCompileStore((s) => s.status === 'compiling');
  const run = useCompileStore((s) => s.run);

  return (
    <button
      type="button"
      onClick={() => void run(sketchRequest(code, fullFqbn(getBoard(boardId), { ota })), { ota })}
      disabled={compiling || code === ''}
      aria-busy={compiling}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60"
    >
      {compiling ? t('UI_COMPILING', lang) : t('UI_COMPILE', lang)}
    </button>
  );
}
