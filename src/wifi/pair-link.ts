import { useProjectsStore } from '../projects/store';
import { newPairing, type PairingParams } from './pairing';
import { getDevice } from './relay-client';

/** How long the board's name may take to come back from the relay before we pair without it. */
export const NAME_LOOKUP_MS = 3_000;

const attached = new WeakSet<PairingParams>();

/**
 * Attaches a pairing link (`/pair?device=…&token=…`, already taken out of the address bar)
 * to the open project and says so. The board's name comes from the relay when it answers
 * quickly (the link itself carries no name); otherwise `placa-<last 4 of the MAC>`.
 */
export async function attachPairing(params: PairingParams): Promise<void> {
  // Once per link (React StrictMode runs effects twice in development).
  if (attached.has(params)) return;
  attached.add(params);
  const pairing = newPairing(params);
  if (!params.name) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAME_LOOKUP_MS);
    try {
      const device = await getDevice(pairing, controller.signal);
      if (device.name) Object.assign(pairing, newPairing({ ...params, name: device.name }));
    } catch {
      // Offline board, unknown to the relay, or no network: the fallback name will do.
    } finally {
      clearTimeout(timer);
    }
  }
  await useProjectsStore.getState().init();
  await useProjectsStore.getState().setPairing(pairing, { notify: true });
}
