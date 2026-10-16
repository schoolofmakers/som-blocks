import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sketchRequest } from './client';
import { FALLBACK_SERVER_URL, SERVER_URL_STORAGE_KEY, useCompileStore } from './store';

const initial = useCompileStore.getState();
const req = sketchRequest('void setup() {}\nvoid loop() {}\n', 'arduino:avr:uno');
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  useCompileStore.setState(initial, true);
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('useCompileStore', () => {
  it('defaults to the local server when nothing is configured', () => {
    expect(initial.serverUrl).toBe(FALLBACK_SERVER_URL);
  });

  it('persists a custom server URL and resets to the default on empty input', () => {
    useCompileStore.getState().setServerUrl(' https://compile.example.cl ');
    expect(useCompileStore.getState().serverUrl).toBe('https://compile.example.cl');
    expect(window.localStorage.getItem(SERVER_URL_STORAGE_KEY)).toBe('https://compile.example.cl');

    useCompileStore.getState().setServerUrl('');
    expect(useCompileStore.getState().serverUrl).toBe(FALLBACK_SERVER_URL);
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
    expect(fetchMock.mock.calls[0]![0]).toBe(`${FALLBACK_SERVER_URL}/v3/compile`);
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
