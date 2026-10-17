import { useState } from 'react';
import { getBoard } from '../boards/registry';
import { supportsOta } from '../boards/types';
import { format, t, type Lang, type MessageKey } from '../i18n/messages';
import { useProjectsStore } from '../projects/store';
import type { Presence } from '../transport/relay';
import { useTransportStore } from '../transport/store';
import { isWebSerialSupported } from '../transport/web-serial';
import { isBluetoothSupported } from './improv';
import { ProvisionDialog, type ProvisionKind } from './ProvisionDialog';

const PRESENCE_KEYS: Record<Presence, MessageKey> = {
  online: 'UI_WIFI_ONLINE',
  offline: 'UI_WIFI_OFFLINE',
  unknown: 'UI_WIFI_CHECKING',
};

interface WifiConnectProps {
  lang: Lang;
  boardId: string;
}

/**
 * The connect screen's WiFi part: connect to the project's paired board through the relay,
 * or teach a board the WiFi (Improv over the cable or Bluetooth), which also pairs it.
 */
export function WifiConnect({ lang, boardId }: WifiConnectProps) {
  const pairing = useProjectsStore((s) => s.current?.wifi);
  const setPairing = useProjectsStore((s) => s.setPairing);
  const status = useTransportStore((s) => s.status);
  const overWifi = useTransportStore((s) => s.transport?.kind === 'relay');
  const presence = useTransportStore((s) => s.presence);
  const connectRelay = useTransportStore((s) => s.connectRelay);
  const [provisioning, setProvisioning] = useState<ProvisionKind | null>(null);

  if (!supportsOta(getBoard(boardId))) {
    return (
      <p data-testid="wifi-unsupported-board" className="text-muted">
        {t('UI_WIFI_NO_WIFI_BOARD', lang)}
      </p>
    );
  }

  if (provisioning) {
    return (
      <ProvisionDialog
        lang={lang}
        kind={provisioning}
        boardId={boardId}
        onClose={() => setProvisioning(null)}
      />
    );
  }

  const serial = isWebSerialSupported();
  const bluetooth = isBluetoothSupported();
  const busy = status === 'connecting';

  return (
    <div data-testid="wifi-section" className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-sm font-bold">{t('UI_WIFI_TITLE', lang)}</h3>

      {pairing ? (
        <p data-testid="wifi-paired">
          {format(t('UI_WIFI_PAIRED_WITH', lang), { name: pairing.name })}
        </p>
      ) : (
        <p className="text-muted">{t('UI_WIFI_NOT_PAIRED', lang)}</p>
      )}

      {overWifi && presence && (
        <p data-testid="wifi-presence" className={presence === 'online' ? 'text-ok' : 'text-warn'}>
          {t(PRESENCE_KEYS[presence], lang)}
        </p>
      )}

      {pairing && !overWifi && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="connect-wifi"
            disabled={busy}
            onClick={() => void connectRelay(pairing)}
            className="min-h-11 flex-1 rounded-md bg-accent px-3 font-semibold text-bg disabled:opacity-50"
          >
            {t('UI_WIFI_CONNECT', lang)}
          </button>
          <button
            type="button"
            data-testid="wifi-forget"
            disabled={busy}
            onClick={() => void setPairing(null)}
            className="min-h-11 rounded-md px-2 text-muted underline underline-offset-2"
          >
            {t('UI_WIFI_FORGET', lang)}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-testid="provision-serial"
          disabled={!serial || busy}
          onClick={() => setProvisioning('serial')}
          className="min-h-11 rounded-md border border-border px-3 text-left font-semibold disabled:opacity-50"
        >
          {t('UI_WIFI_PROVISION_SERIAL', lang)}
        </button>
        <button
          type="button"
          data-testid="provision-ble"
          disabled={!bluetooth || busy}
          onClick={() => setProvisioning('ble')}
          className="min-h-11 rounded-md border border-border px-3 text-left font-semibold disabled:opacity-50"
        >
          {t('UI_WIFI_PROVISION_BLE', lang)}
        </button>
        {(!serial || !bluetooth) && (
          <p data-testid="wifi-provision-hint" className="text-xs text-muted">
            {t('UI_WIFI_PROVISION_HINT', lang)}
          </p>
        )}
      </div>
    </div>
  );
}
