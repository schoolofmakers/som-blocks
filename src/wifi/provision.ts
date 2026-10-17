import { getBoard } from '../boards/registry';
import { useSerialStore } from '../serial/store';
import { useTransportStore } from '../transport/store';
import { TransportError, type Transport } from '../transport/types';
import { requestPort, type SerialPortLike } from '../transport/web-serial';
import { ImprovError, openSerialImprov, requestBleImprov, type ImprovSession } from './improv';

// Getting an Improv session for the provisioning dialog, and giving everything back after.
// Over the cable the board is usually already connected: like the flashers (src/flash/
// store.ts), the open USB transport is lent out — the serial monitor is muted, our transport
// closes the port, the Improv SDK gets it opened at 115200, and at the end the port is closed
// and our transport reopens it at the monitor's baud.

/** Improv over serial runs at 115200 (the SDK's own launcher opens the port at this rate). */
export const IMPROV_BAUD = 115200;

export interface ImprovLease {
  session: ImprovSession;
  /** Closes the session and hands the port back. Safe to call twice. */
  release(): Promise<void>;
}

function improvError(error: unknown): ImprovError {
  if (error instanceof ImprovError) return error;
  if (error instanceof TransportError) {
    if (error.code === 'cancelled') return new ImprovError('cancelled');
    if (error.code === 'unsupported') return new ImprovError('unsupported');
    return new ImprovError('failed', error.detail ?? error.message);
  }
  return new ImprovError('failed', error instanceof Error ? error.message : String(error));
}

/** Reopens our transport if the connect screen still owns it (as `flash/store` giveBack). */
async function giveBack(lent: Transport): Promise<void> {
  const store = useTransportStore.getState();
  if (store.transport === lent) await store.reopen(useSerialStore.getState().baud);
  await useSerialStore.getState().setMuted(false);
}

/**
 * Improv over the USB cable. Must be called synchronously inside a click: without a
 * connected board it opens the port chooser (user activation).
 */
export function leaseSerialImprov(boardId: string): Promise<ImprovLease> {
  const store = useTransportStore.getState();
  const lent =
    store.status === 'connected' && store.transport?.kind === 'web-serial' ? store.transport : null;
  const pendingPort: Promise<SerialPortLike> = lent
    ? Promise.resolve(lent.nativePort as SerialPortLike)
    : requestPort(getBoard(boardId).usbFilters);

  return (async () => {
    let port: SerialPortLike;
    try {
      port = await pendingPort;
    } catch (error) {
      throw improvError(error);
    }
    if (lent) {
      // The monitor keeps away while the port is lent; then our transport lets go of it.
      await useSerialStore.getState().setMuted(true);
      await lent.close();
    }
    let opened = false;
    let session: ImprovSession | undefined;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await session?.close().catch(() => undefined);
      if (opened) await port.close().catch(() => undefined);
      if (lent) await giveBack(lent);
    };
    try {
      await port.open({ baudRate: IMPROV_BAUD });
      opened = true;
      session = await openSerialImprov(port);
    } catch (error) {
      await release();
      throw improvError(error);
    }
    return { session, release };
  })();
}

/** Improv over Bluetooth LE (Android Chrome). Call synchronously inside a click. */
export function leaseBleImprov(): Promise<ImprovLease> {
  return requestBleImprov().then(
    (session) => {
      let released = false;
      return {
        session,
        release: async () => {
          if (released) return;
          released = true;
          await session.close().catch(() => undefined);
        },
      };
    },
    (error: unknown) => {
      throw improvError(error);
    },
  );
}
