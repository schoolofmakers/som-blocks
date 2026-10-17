import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryProjectRepo } from '../projects/db';
import { resetProjectsStore, useProjectsStore } from '../projects/store';
import { DEVICE, FakeRelay, TOKEN } from '../test/fake-relay';
import { attachPairing } from './pair-link';
import { RELAY_URL_STORAGE_KEY } from './pairing';

describe('attachPairing (a /pair link)', () => {
  let relay: FakeRelay;
  let restore: () => void;

  beforeEach(async () => {
    window.localStorage.setItem(RELAY_URL_STORAGE_KEY, 'http://relay.test');
    relay = new FakeRelay();
    restore = relay.install();
    resetProjectsStore();
    await useProjectsStore.getState().init({ repo: new MemoryProjectRepo() });
  });

  afterEach(() => {
    restore();
    window.localStorage.removeItem(RELAY_URL_STORAGE_KEY);
  });

  it('pairs the open project, named by the relay, and says so once', async () => {
    const params = { deviceId: DEVICE, token: TOKEN };
    await attachPairing(params);
    await attachPairing(params); // StrictMode re-run: no second attach
    expect(useProjectsStore.getState().current?.wifi).toEqual({
      deviceId: DEVICE,
      token: TOKEN,
      name: 'placa-azul',
      relayUrl: 'http://relay.test',
    });
    expect(useProjectsStore.getState().notice).toEqual({ kind: 'paired', name: 'placa-azul' });
    expect(relay.requests.filter((r) => r.path === `/v1/devices/${DEVICE}`)).toHaveLength(1);
  });

  it('falls back to placa-<MAC end> when the relay does not know the board', async () => {
    relay.device = null;
    await attachPairing({ deviceId: DEVICE, token: TOKEN });
    expect(useProjectsStore.getState().current?.wifi?.name).toBe('placa-c3c3');
  });
});
