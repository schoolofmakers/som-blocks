import { format, t, type Lang, type MessageKey } from '../i18n/messages';
import { DEFAULT_COMPILE_TIMEOUT_MS } from './client';
import type { CompileState } from './store';
import { firmwareBytes, type CompileErrorCause } from './types';

const ERROR_KEYS: Record<CompileErrorCause, MessageKey> = {
  'no-firmware': 'UI_COMPILE_ERR_NO_FIRMWARE',
  'server-error': 'UI_COMPILE_ERR_SERVER',
  timeout: 'UI_COMPILE_ERR_TIMEOUT',
  network: 'UI_COMPILE_ERR_NETWORK',
  'empty-body': 'UI_COMPILE_ERR_EMPTY',
};

function seconds(ms: number | null): string {
  return ((ms ?? 0) / 1000).toFixed(1);
}

type StatusInput = Pick<CompileState, 'status' | 'result' | 'error' | 'durationMs' | 'requestUrl'>;

/** The one-line status above the log, in the student's language. */
export function statusLine(state: StatusInput, lang: Lang): string {
  const { status, result, error, durationMs, requestUrl } = state;
  if (status === 'compiling') return t('UI_COMPILE_RUNNING', lang);
  if (status === 'ok' && result) {
    const bytes = firmwareBytes(result);
    return result.kind === 'avr'
      ? format(t('UI_COMPILE_OK_AVR', lang), { seconds: seconds(durationMs), bytes })
      : format(t('UI_COMPILE_OK_ESP', lang), {
          seconds: seconds(durationMs),
          count: result.images.length,
          bytes,
        });
  }
  if (status === 'error' && error) {
    const message = format(t(ERROR_KEYS[error.cause], lang), {
      message: error.message,
      seconds: Math.round(DEFAULT_COMPILE_TIMEOUT_MS / 1000),
      url: requestUrl ?? '',
    });
    const after = format(t('UI_COMPILE_ERR_DURATION', lang), { seconds: seconds(durationMs) });
    return `${message} (${after})`;
  }
  return t('UI_COMPILE_IDLE', lang);
}

// arduino-cli colours its summary table ("Used platform …") with ANSI SGR codes, which a
// <pre> would print as `[92m` noise. Removing the escape codes changes no character of
// the actual output.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}
