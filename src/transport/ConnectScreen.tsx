import { useEffect, useId, useMemo, useState } from 'react';
import { boardLabel, getBoard } from '../boards/registry';
import { useBoardStore } from '../boards/store';
import { t, type Lang, type MessageKey } from '../i18n/messages';
import { portLabel } from './port-label';
import { useTransportStore, type ConnectionStatus } from './store';
import { detectSupport } from './support';
import { isWebSerialSupported, rememberedPorts, type SerialPortLike } from './web-serial';

const STATUS_KEYS: Record<ConnectionStatus, MessageKey> = {
  disconnected: 'UI_CONNECT_STATUS_DISCONNECTED',
  connecting: 'UI_CONNECT_STATUS_CONNECTING',
  connected: 'UI_CONNECT_STATUS_CONNECTED',
  error: 'UI_CONNECT_STATUS_ERROR',
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  disconnected: 'bg-muted',
  connecting: 'bg-warn',
  connected: 'bg-ok',
  error: 'bg-danger',
};

interface ConnectProps {
  lang: Lang;
}

/** Header button: status dot + label; opens the connect screen as a popover. */
export function ConnectButton({ lang }: ConnectProps) {
  const status = useTransportStore((state) => state.status);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="connect-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 py-1 text-sm font-semibold text-fg"
      >
        <span aria-hidden="true" className={`size-2.5 rounded-full ${STATUS_DOT[status]}`} />
        <span data-testid="connect-status">{t(STATUS_KEYS[status], lang)}</span>
      </button>
      {open && (
        <div
          id={panelId}
          className="fixed inset-x-4 top-4 z-20 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <ConnectScreen lang={lang} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

interface ConnectScreenProps extends ConnectProps {
  onClose?: () => void;
}

export function ConnectScreen({ lang, onClose }: ConnectScreenProps) {
  const titleId = useId();
  const reasonId = useId();
  const boardId = useBoardStore((state) => state.boardId);
  const board = getBoard(boardId);
  const status = useTransportStore((state) => state.status);
  const label = useTransportStore((state) => state.portLabel);
  const error = useTransportStore((state) => state.error);
  const connect = useTransportStore((state) => state.connect);
  const disconnect = useTransportStore((state) => state.disconnect);

  const support = useMemo(
    () =>
      detectSupport(
        typeof navigator === 'undefined' ? '' : navigator.userAgent,
        isWebSerialSupported(),
      ),
    [],
  );
  const usbReady = support.usb === 'yes';
  const busy = status === 'connecting';
  const connected = status === 'connected';

  const [remembered, setRemembered] = useState<SerialPortLike[]>([]);
  useEffect(() => {
    if (!usbReady || connected) return;
    let live = true;
    void rememberedPorts().then((ports) => {
      if (live) setRemembered(ports);
    });
    return () => {
      live = false;
    };
  }, [usbReady, connected]);

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      data-testid="connect-screen"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm text-fg shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="text-base font-bold">
          {t('UI_CONNECT_TITLE', lang)}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-md px-2 text-muted underline-offset-2 hover:underline"
          >
            {t('UI_CONNECT_CLOSE', lang)}
          </button>
        )}
      </div>

      <p>
        <span className="text-muted">{t('UI_CONNECT_BOARD', lang)}: </span>
        <span data-testid="connect-board" className="font-semibold">
          {boardLabel(board, lang)}
        </span>
      </p>

      <table className="w-full border-collapse text-left">
        <caption className="mb-1 text-left text-xs font-semibold text-muted">
          {t('UI_CONNECT_SUPPORT_TITLE', lang)}
        </caption>
        <tbody>
          <tr data-testid="support-usb" className="border-t border-border">
            <th scope="row" className="py-1 pr-2 font-normal">
              {t('UI_CONNECT_ROW_USB', lang)}
            </th>
            <td className={`py-1 font-semibold ${usbReady ? 'text-ok' : 'text-danger'}`}>
              {t(usbReady ? 'UI_CONNECT_USB_YES' : 'UI_CONNECT_USB_NO', lang)}
            </td>
          </tr>
          <tr data-testid="support-wifi" className="border-t border-border">
            <th scope="row" className="py-1 pr-2 font-normal">
              {t('UI_CONNECT_ROW_WIFI', lang)}
            </th>
            <td className="py-1 font-semibold text-muted">{t('UI_CONNECT_WIFI_COMING', lang)}</td>
          </tr>
        </tbody>
      </table>

      {support.reasons.length > 0 && (
        <div id={reasonId} data-testid="support-reason" className="text-danger">
          {support.reasons.map((reason) => (
            <p key={reason}>{t(reason, lang)}</p>
          ))}
        </div>
      )}

      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p data-testid="connect-port">
            {t('UI_CONNECT_CONNECTED_TO', lang)}{' '}
            <span className="font-semibold">{label ?? t('UI_CONNECT_UNKNOWN_PORT', lang)}</span>
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="min-h-11 rounded-md border border-border px-3 font-semibold"
          >
            {t('UI_CONNECT_DISCONNECT', lang)}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            data-testid="connect-usb"
            disabled={!usbReady || busy}
            aria-describedby={usbReady ? undefined : reasonId}
            // requestPort runs synchronously inside this click (user activation).
            onClick={() => void connect(boardId)}
            className="min-h-11 rounded-md bg-accent px-3 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(busy ? 'UI_CONNECT_STATUS_CONNECTING' : 'UI_CONNECT_USB_BUTTON', lang)}
          </button>

          {usbReady && remembered.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-muted">{t('UI_CONNECT_REMEMBERED', lang)}</p>
              {remembered.map((port, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={busy}
                  onClick={() => void connect(boardId, { port })}
                  className="min-h-11 rounded-md border border-border px-3 text-left disabled:opacity-50"
                >
                  {t('UI_CONNECT_RECONNECT', lang)}:{' '}
                  {portLabel(port.getInfo(), boardId) ?? t('UI_CONNECT_UNKNOWN_PORT', lang)}
                </button>
              ))}
            </div>
          )}

          {usbReady && (
            <p className="text-xs text-muted">
              {t('UI_CONNECT_ANY_PORT_HINT', lang)}{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => void connect(boardId, { anyPort: true })}
                className="min-h-11 font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
              >
                {t('UI_CONNECT_ANY_PORT_BUTTON', lang)}
              </button>
            </p>
          )}
        </>
      )}

      {error && (
        <div role="alert" data-testid="connect-error" className="text-danger">
          <p>{t(error.key, lang)}</p>
          {error.detail && <p className="mt-1 font-mono text-xs text-muted">{error.detail}</p>}
        </div>
      )}
    </section>
  );
}
