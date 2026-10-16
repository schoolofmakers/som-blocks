import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sketchRequest } from './client';
import {
  defaultServerUrl,
  FALLBACK_SERVER_URL,
  SERVER_URL_STORAGE_KEY,
  useCompileStore,
} from './store';

const initial = useCompileStore.getState();
const req = sketchRequest('void setup() {}\nvoid loop() {}\n', 'arduino:avr:uno');
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  useCompileStore.setState(initial, true);
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('defaultServerUrl()', () => {
  it('uses VITE_COMPILE_SERVER_URL when set', () => {
    vi.stubEnv('VITE_COMPILE_SERVER_URL', 'https://compile.example.cl');
    expect(defaultServerUrl()).toBe('https://compile.example.cl');
  });

  it('falls back to the local server when unset or blank', () => {
    vi.stubEnv('VITE_COMPILE_SERVER_URL', ' ');
    expect(defaultServerUrl()).toBe(FALLBACK_SERVER_URL);
  });
});

// The store reads the environment at import, so these compare with defaultServerUrl()
// rather than a literal: they pass whether or not a developer set VITE_COMPILE_SERVER_URL.
describe('useCompileStore', () => {
  it('starts on the default server when nothing is saved', () => {
    expect(initial.serverUrl).toBe(defaultServerUrl());
  });

  it('persists a custom server URL and resets to the default on empty input', () => {
    useCompileStore.getState().setServerUrl(' https://compile.example.cl ');
    expect(useCompileStore.getState().serverUrl).toBe('https://compile.example.cl');
    expect(window.localStorage.getItem(SERVER_URL_STORAGE_KEY)).toBe('https://compile.example.cl');

    useCompileStore.getState().setServerUrl('');
    expect(useCompileStore.getState().serverUrl).toBe(defaultServerUrl());
    expect(window.localStorage.getItem(SERVER_URL_STORAGE_KEY)).toBeNull();
  });

  it('goes compiling → ok and keeps result, log and duration', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ hex: btoa(':00000001FF\n'), log: 'Sketch uses 444 bytes' })),
    );
    const done = useCompileStore.getState().run(req);
    expect(useCompileStore.getState().status).toBe('compiling');
    await done;
    const state = useCompileStore.getState();
    expect(state.status).toBe('ok');
    expect(state.result?.kind).toBe('avr');
    expect(state.log).toBe('Sketch uses 444 bytes');
    expect(state.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${defaultServerUrl()}/v3/compile`);
    expect(state.requestUrl).toBe(defaultServerUrl());
  });

  it('goes compiling → error and surfaces the gcc log', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ log: 'error: boom' })));
    await useCompileStore.getState().run(req);
    const state = useCompileStore.getState();
    expect(state.status).toBe('error');
    expect(state.error?.cause).toBe('no-firmware');
    expect(state.log).toBe('error: boom');
    expect(state.result).toBeNull();
  });

  it('keeps the URL the compile used even if the setting changes afterwards', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    useCompileStore.getState().setServerUrl('http://first.test');
    await useCompileStore.getState().run(req);
    useCompileStore.getState().setServerUrl('http://second.test');
    expect(useCompileStore.getState().requestUrl).toBe('http://first.test');
    expect(useCompileStore.getState().error?.cause).toBe('network');
  });

  it('ignores a second run while one is in flight', async () => {
    let resolve!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
    const first = useCompileStore.getState().run(req);
    await useCompileStore.getState().run(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({ hex: btoa(':00000001FF\n'), log: '' })));
    await first;
    expect(useCompileStore.getState().status).toBe('ok');
  });
});
