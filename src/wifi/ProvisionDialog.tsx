import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { format, t, type Lang, type MessageKey } from '../i18n/messages';
import { useProjectsStore } from '../projects/store';
import { ImprovError, type ImprovErrorCode, type ProvisionPhase } from './improv';
import { newPairing, parsePairingUrl } from './pairing';
import { leaseBleImprov, leaseSerialImprov, type ImprovLease } from './provision';

// "Conectar a WiFi": teach the board the classroom WiFi with Improv (over the cable or over
// Bluetooth), then keep the pairing the board returns in its provisioned URL
// (_config/architecture.md → Track D → Provisioning, Pairing). Steps: find the board →
// network name + password → authorizing (BLE: press the board's button) → provisioning →
// done. The password is sent to the board only; it is never stored or logged.

export type ProvisionKind = 'serial' | 'ble';

type Step =
  | { name: 'start' }
  | { name: 'finding' }
  | { name: 'form' }
  | { name: 'working'; phase: ProvisionPhase }
  | { name: 'done'; board: string }
  | { name: 'error'; code: ImprovErrorCode; detail?: string; canRetry: boolean };

const ERROR_KEYS: Record<ImprovErrorCode, MessageKey> = {
  unsupported: 'UI_PROVISION_ERR_UNSUPPORTED',
  cancelled: 'UI_PROVISION_ERR_CANCELLED',
  'not-improv': 'UI_PROVISION_ERR_NOT_IMPROV',
  'wrong-password': 'UI_PROVISION_ERR_WRONG_PASSWORD',
  'not-authorized': 'UI_PROVISION_ERR_NOT_AUTHORIZED',
  timeout: 'UI_PROVISION_ERR_TIMEOUT',
  'no-url': 'UI_PROVISION_ERR_NO_URL',
  failed: 'UI_PROVISION_ERR_FAILED',
};

const PHASE_KEYS: Record<ProvisionPhase, MessageKey> = {
  authorizing: 'UI_PROVISION_AUTHORIZING',
  provisioning: 'UI_PROVISION_PROVISIONING',
  provisioned: 'UI_PROVISION_PROVISIONED',
};

interface ProvisionDialogProps {
  lang: Lang;
  kind: ProvisionKind;
  boardId: string;
  onClose: () => void;
}

const asImprovError = (error: unknown) =>
  error instanceof ImprovError ? error : new ImprovError('failed', String(error));

export function ProvisionDialog({ lang, kind, boardId, onClose }: ProvisionDialogProps) {
  const titleId = useId();
  const ssidId = useId();
  const listId = useId();
  const passwordId = useId();
  const [step, setStep] = useState<Step>({ name: 'start' });
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [networks, setNetworks] = useState<string[]>([]);
  const lease = useRef<ImprovLease | null>(null);
  /** Mirrors `lease.current !== null` for rendering (refs are not read during render). */
  const [hasSession, setHasSession] = useState(false);
  const live = useRef(true);
  const setPairing = useProjectsStore((s) => s.setPairing);

  // Closing (or unmounting the connect screen) gives the port / Bluetooth link back.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      void lease.current?.release();
      lease.current = null;
    };
  }, []);

  const fail = (error: unknown, canRetry: boolean) => {
    if (!live.current) return;
    const { code, message } = asImprovError(error);
    setStep({ name: 'error', code, detail: message === code ? undefined : message, canRetry });
  };

  const releaseLease = async () => {
    const current = lease.current;
    lease.current = null;
    if (live.current) setHasSession(false);
    await current?.release();
  };

  // Synchronous up to the chooser: requestPort / requestDevice need the click's activation.
  const find = () => {
    const pending = kind === 'serial' ? leaseSerialImprov(boardId) : leaseBleImprov();
    setStep({ name: 'finding' });
    void pending.then(
      async (got) => {
        if (!live.current) {
          await got.release();
          return;
        }
        lease.current = got;
        setHasSession(true);
        setStep({ name: 'form' });
        const found = await got.session.scan();
        if (live.current && lease.current === got) setNetworks(found);
      },
      (error: unknown) => fail(error, true),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const current = lease.current;
    if (!current || ssid.trim() === '') return;
    setStep({ name: 'working', phase: 'provisioning' });
    let url: string;
    try {
      url = await current.session.provision(ssid.trim(), password, (phase) => {
        if (live.current) setStep({ name: 'working', phase });
      });
    } catch (error) {
      const { code } = asImprovError(error);
      // A wrong password or a timeout can be fixed in the form; anything else starts over.
      const keepSession = code === 'wrong-password' || code === 'timeout';
      if (!keepSession) await releaseLease();
      fail(error, true);
      if (live.current && keepSession) setPassword('');
      return;
    }
    const params = parsePairingUrl(url);
    if (!params) {
      await releaseLease();
      fail(new ImprovError('no-url'), true);
      return;
    }
    const pairing = newPairing({ ...params, name: params.name ?? current.session.name });
    await releaseLease();
    await setPairing(pairing);
    if (live.current) setStep({ name: 'done', board: pairing.name });
  };

  const retry = () => {
    if (step.name === 'error') setStep({ name: 'start' });
  };

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      data-testid="provision-dialog"
      className="flex flex-col gap-3"
    >
      <h3 id={titleId} className="text-base font-bold">
        {t(kind === 'serial' ? 'UI_PROVISION_TITLE_SERIAL' : 'UI_PROVISION_TITLE_BLE', lang)}
      </h3>

      {step.name === 'start' && (
        <>
          <p>{t(kind === 'serial' ? 'UI_PROVISION_HINT_SERIAL' : 'UI_PROVISION_HINT_BLE', lang)}</p>
          <button
            type="button"
            data-testid="provision-find"
            onClick={find}
            className="min-h-11 rounded-md bg-accent px-3 font-semibold text-bg"
          >
            {t('UI_PROVISION_FIND', lang)}
          </button>
        </>
      )}

      {step.name === 'finding' && (
        <p role="status" data-testid="provision-status">
          {t('UI_PROVISION_FINDING', lang)}
        </p>
      )}

      {(step.name === 'form' || (step.name === 'error' && hasSession)) && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
          <label htmlFor={ssidId} className="text-xs font-semibold text-muted">
            {t('UI_PROVISION_SSID', lang)}
          </label>
          <input
            id={ssidId}
            data-testid="provision-ssid"
            value={ssid}
            list={networks.length > 0 ? listId : undefined}
            onChange={(e) => setSsid(e.target.value)}
            autoComplete="off"
            maxLength={32}
            required
            className="min-h-11 rounded-md border border-border bg-bg px-2"
          />
          {networks.length > 0 && (
            <datalist id={listId} data-testid="provision-networks">
              {networks.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <label htmlFor={passwordId} className="text-xs font-semibold text-muted">
            {t('UI_PROVISION_PASSWORD', lang)}
          </label>
          <input
            id={passwordId}
            data-testid="provision-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            maxLength={64}
            className="min-h-11 rounded-md border border-border bg-bg px-2"
          />
          <button
            type="submit"
            data-testid="provision-submit"
            disabled={ssid.trim() === ''}
            className="min-h-11 rounded-md bg-accent px-3 font-semibold text-bg disabled:opacity-50"
          >
            {t('UI_PROVISION_SUBMIT', lang)}
          </button>
        </form>
      )}

      {step.name === 'working' && (
        <p role="status" aria-live="polite" data-testid="provision-status">
          {t(PHASE_KEYS[step.phase], lang)}
        </p>
      )}

      {step.name === 'done' && (
        <p role="status" data-testid="provision-done" className="text-ok">
          {format(t('UI_PROVISION_DONE', lang), { name: step.board })}
        </p>
      )}

      {step.name === 'error' && (
        <div role="alert" data-testid="provision-error" className="text-danger">
          <p>{t(ERROR_KEYS[step.code], lang)}</p>
          {step.detail && <p className="mt-1 font-mono text-xs text-muted">{step.detail}</p>}
          {step.canRetry && !hasSession && (
            <button
              type="button"
              onClick={retry}
              className="mt-2 min-h-11 rounded-md border border-border px-3 font-semibold text-fg"
            >
              {t('UI_PROVISION_RETRY', lang)}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        data-testid="provision-close"
        disabled={step.name === 'working'}
        onClick={onClose}
        className="min-h-11 rounded-md border border-border px-3 disabled:opacity-50"
      >
        {t(step.name === 'done' ? 'UI_PROVISION_FINISH' : 'UI_CONNECT_CLOSE', lang)}
      </button>
    </section>
  );
}
