import { useId, useMemo } from 'react';
import { useCompileStore } from '../compile/store';
import { format, t, type Lang, type MessageKey } from '../i18n/messages';
import { useTransportStore } from '../transport/store';
import { detectSupport } from '../transport/support';
import { isWebSerialSupported } from '../transport/web-serial';
import { useFlashStore, type UploadStatus } from './store';
import type { FlashPhase } from './types';

const PHASE_KEYS: Record<FlashPhase, MessageKey> = {
  connect: 'UI_UPLOAD_PHASE_CONNECT',
  erase: 'UI_UPLOAD_PHASE_ERASE',
  write: 'UI_UPLOAD_PHASE_WRITE',
  verify: 'UI_UPLOAD_PHASE_VERIFY',
  reset: 'UI_UPLOAD_PHASE_RESET',
  done: 'UI_UPLOAD_PHASE_DONE',
};

function phaseText(
  status: UploadStatus,
  phase: FlashPhase | null,
  percent: number,
  lang: Lang,
): string {
  if (status === 'compiling') return t('UI_UPLOAD_PHASE_COMPILE', lang);
  if (status === 'done') return t('UI_UPLOAD_PHASE_DONE', lang);
  return format(t(PHASE_KEYS[phase ?? 'connect'], lang), { percent });
}

interface UploadButtonProps {
  lang: Lang;
  /** The sketch the generator produced; Upload recompiles first when it changed. */
  code: string;
  boardId: string;
}

/** Header Upload button, next to Compile: why it is disabled, progress, and errors. */
export function UploadButton({ lang, code, boardId }: UploadButtonProps) {
  const reasonId = useId();
  const status = useFlashStore((s) => s.status);
  const phase = useFlashStore((s) => s.phase);
  const percent = useFlashStore((s) => s.percent);
  const canCancel = useFlashStore((s) => s.canCancel);
  const error = useFlashStore((s) => s.error);
  const upload = useFlashStore((s) => s.upload);
  const cancel = useFlashStore((s) => s.cancel);
  const compiled = useCompileStore((s) => s.result !== null);
  const compiling = useCompileStore((s) => s.status === 'compiling');
  const connected = useTransportStore((s) => s.status === 'connected');

  const support = useMemo(
    () =>
      detectSupport(
        typeof navigator === 'undefined' ? '' : navigator.userAgent,
        isWebSerialSupported(),
      ),
    [],
  );

  const busy = status === 'compiling' || status === 'flashing';
  // In priority order: the browser first (nothing else helps), then compile, then connect.
  const reason: MessageKey | null =
    support.usb === 'no'
      ? (support.reasons[0] ?? 'UI_CONNECT_ERROR_UNSUPPORTED')
      : !compiled
        ? 'UI_UPLOAD_REASON_COMPILE'
        : !connected
          ? 'UI_UPLOAD_REASON_CONNECT'
          : null;
  const disabled = busy || compiling || code === '' || reason !== null;

  return (
    <div className="flex max-w-xs flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="upload-button"
          onClick={() => void upload({ code, boardId })}
          disabled={disabled}
          aria-busy={busy}
          aria-describedby={reason && !busy ? reasonId : undefined}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60"
        >
          {busy ? t('UI_UPLOADING', lang) : t('UI_UPLOAD', lang)}
        </button>
        {busy && canCancel && (
          <button
            type="button"
            data-testid="upload-cancel"
            onClick={cancel}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {t('UI_UPLOAD_CANCEL', lang)}
          </button>
        )}
      </div>
      {reason && !busy && (
        <p id={reasonId} data-testid="upload-reason" className="text-xs text-muted">
          {t(reason, lang)}
        </p>
      )}
      {(busy || status === 'done') && (
        <div role="status" aria-live="polite" data-testid="upload-status" className="text-xs">
          <progress
            max={100}
            value={status === 'compiling' ? undefined : percent}
            className="h-2 w-full"
          />
          <p className={status === 'done' ? 'text-ok' : 'text-muted'}>
            {phaseText(status, phase, percent, lang)}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" data-testid="upload-error" className="text-xs text-danger">
          {t(error.key, lang)}
        </p>
      )}
    </div>
  );
}
