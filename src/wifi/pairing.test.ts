import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultRelayUrl,
  deviceName,
  FALLBACK_RELAY_URL,
  newPairing,
  parsePairingUrl,
  RELAY_URL_STORAGE_KEY,
  takePairingFromLocation,
  toPairing,
} from './pairing';

const DEVICE = 'fa4e00c3c3c3';
const TOKEN = 'ab'.repeat(32);

function fakeLocation(href: string) {
  const history = {
    state: { keep: true },
    replaceState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
      location.href = String(url);
    }),
  };
  const location = { href };
  return { location, history };
}

describe('parsePairingUrl', () => {
  it('reads device and token from a provisioned URL on any editor origin', () => {
    expect(
      parsePairingUrl(`https://blocks.example.cl/pair?device=${DEVICE}&token=${TOKEN}`),
    ).toEqual({ deviceId: DEVICE, token: TOKEN });
    expect(
      parsePairingUrl(
        `http://127.0.0.1:5173/app/pair/?device=FA4E00C3C3C3&token=${TOKEN}&name=Azul`,
      ),
    ).toEqual({ deviceId: DEVICE, token: TOKEN, name: 'Azul' });
  });

  it('rejects other paths, malformed ids and tokens', () => {
    expect(parsePairingUrl(`https://x/?device=${DEVICE}&token=${TOKEN}`)).toBeNull();
    expect(parsePairingUrl(`https://x/pair?device=fa4e00&token=${TOKEN}`)).toBeNull();
    expect(parsePairingUrl(`https://x/pair?device=${DEVICE}&token=nothex`)).toBeNull();
    expect(parsePairingUrl(`https://x/pair?device=${DEVICE}`)).toBeNull();
    expect(parsePairingUrl('not a url')).toBeNull();
  });
});

describe('takePairingFromLocation', () => {
  it('takes the pairing and leaves no token in the address', () => {
    const { location, history } = fakeLocation(
      `https://blocks.example.cl/pair?device=${DEVICE}&token=${TOKEN}&lang=en`,
    );
    expect(takePairingFromLocation(location, history)).toEqual({ deviceId: DEVICE, token: TOKEN });
    expect(location.href).toBe('https://blocks.example.cl/?lang=en');
    expect(location.href).not.toContain(TOKEN);
    expect(history.replaceState).toHaveBeenCalledWith({ keep: true }, '', expect.any(URL));
  });

  it('keeps a sub-path deploy and cleans a bad link too', () => {
    const { location, history } = fakeLocation(`https://x.cl/som/pair?device=bad&token=${TOKEN}`);
    expect(takePairingFromLocation(location, history)).toBeNull();
    expect(location.href).toBe('https://x.cl/som/');
  });

  it('strips stray device/token params elsewhere, and leaves normal pages alone', () => {
    const stray = fakeLocation(`https://x.cl/?token=${TOKEN}`);
    expect(takePairingFromLocation(stray.location, stray.history)).toBeNull();
    expect(stray.location.href).toBe('https://x.cl/');
    const plain = fakeLocation('https://x.cl/?lang=es');
    expect(takePairingFromLocation(plain.location, plain.history)).toBeNull();
    expect(plain.history.replaceState).not.toHaveBeenCalled();
  });
});

describe('stored pairings', () => {
  afterEach(() => {
    window.localStorage.removeItem(RELAY_URL_STORAGE_KEY);
    vi.unstubAllEnvs();
  });

  it('newPairing names the board and uses the editor relay', () => {
    expect(newPairing({ deviceId: DEVICE, token: TOKEN })).toEqual({
      deviceId: DEVICE,
      token: TOKEN,
      name: 'placa-c3c3',
      relayUrl: FALLBACK_RELAY_URL,
    });
    window.localStorage.setItem(RELAY_URL_STORAGE_KEY, 'https://relay.example/');
    expect(defaultRelayUrl()).toBe('https://relay.example');
  });

  it('toPairing accepts only well-formed records', () => {
    const good = { deviceId: DEVICE, token: TOKEN, name: 'Azul', relayUrl: 'https://r' };
    expect(toPairing(good)).toEqual(good);
    expect(toPairing({ ...good, token: 'x' })).toBeNull();
    expect(toPairing({ ...good, relayUrl: 'javascript:alert(1)' })).toBeNull();
    expect(toPairing(null)).toBeNull();
  });

  it('deviceName strips control characters and bounds the length', () => {
    expect(deviceName('Placa\u0007 azul', DEVICE)).toBe('Placa azul');
    expect(deviceName('x'.repeat(100), DEVICE)).toHaveLength(64);
    expect(deviceName('  ', DEVICE)).toBe('placa-c3c3');
  });
});
