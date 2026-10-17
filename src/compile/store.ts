import { create } from 'zustand';
import { compile } from './client';
import { CompileError, type CompileRequest, type CompileResult } from './types';

export const SERVER_URL_STORAGE_KEY = 'som.compileServerUrl';
export const FALLBACK_SERVER_URL = 'http://127.0.0.1:3031';

export type CompileStatus = 'idle' | 'compiling' | 'ok' | 'error';

export function defaultServerUrl(): string {
  const fromEnv = import.meta.env.VITE_COMPILE_SERVER_URL as string | undefined;
  return fromEnv?.trim() || FALLBACK_SERVER_URL;
}

// The URL is the only persisted field, stored as a plain string (same blocked-storage
// handling as src/i18n/lang.ts). Compile results stay in memory.
function readStoredUrl(): string | null {
  try {
    return window.localStorage.getItem(SERVER_URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredUrl(url: string | null): void {
  try {
    if (url === null) window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
    else window.localStorage.setItem(SERVER_URL_STORAGE_KEY, url);
  } catch {
    // Storage blocked: the URL still applies for this session.
  }
}

export interface CompileState {
  status: CompileStatus;
  /** arduino-cli output of the last compile, success or failure, verbatim. */
  log: string;
  result: CompileResult | null;
  /** What the last compile was asked to build; tells Upload whether `result` is current. */
  request: CompileRequest | null;
  /** The last compile was for over-the-air upload ("sube por WiFi", smaller app slot). */
  ota: boolean;
  error: CompileError | null;
  durationMs: number | null;
  /** The server the last compile went to (errors name it, even if the setting changed). */
  requestUrl: string | null;
  serverUrl: string;
  /** Saves a custom server URL; an empty string goes back to the default. */
  setServerUrl: (url: string) => void;
  run: (req: CompileRequest, options?: { ota?: boolean }) => Promise<void>;
}

export const useCompileStore = create<CompileState>()((set, get) => ({
  status: 'idle',
  log: '',
  result: null,
  request: null,
  ota: false,
  error: null,
  durationMs: null,
  requestUrl: null,
  serverUrl: readStoredUrl()?.trim() || defaultServerUrl(),

  setServerUrl: (url) => {
    const trimmed = url.trim();
    writeStoredUrl(trimmed === '' ? null : trimmed);
    set({ serverUrl: trimmed || defaultServerUrl() });
  },

  run: async (req, { ota = false } = {}) => {
    if (get().status === 'compiling') return;
    const requestUrl = get().serverUrl;
    set({
      status: 'compiling',
      log: '',
      result: null,
      request: req,
      ota,
      error: null,
      durationMs: null,
      requestUrl,
    });
    const started = performance.now();
    try {
      const result = await compile(requestUrl, req);
      set({
        status: 'ok',
        result,
        log: result.log,
        durationMs: performance.now() - started,
      });
    } catch (err) {
      const error =
        err instanceof CompileError
          ? err
          : new CompileError('network', err instanceof Error ? err.message : String(err));
      set({
        status: 'error',
        error,
        log: error.log,
        durationMs: performance.now() - started,
      });
    }
  },
}));
