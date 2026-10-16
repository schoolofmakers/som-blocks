// HTTP client for the compile server (duinoapp-server v3). Pure module: no DOM, no React.
//
// Contract: _config/architecture.md → "Compile server API". The rules that matter here:
// - firmware presence is the only success signal: on a gcc error the server answers
//   `{log}` with no `hex`/`files` and often no `error`;
// - `{error: {Cause, Message}}` is an arduino-cli failure (bad fqbn, missing core…);
// - the server occasionally answers HTTP 200 with an empty body (e.g. malformed libs);
// - compiles take up to ~30 s, so the client gives up a little later than that.
//
// Timeout pattern (one AbortController per request, a setTimeout that aborts it, cleared in
// `finally`) follows paperclipai/paperclip cli/src/commands/client/plugin.ts. The "no
// hex/files means failed" rule matches duinoapp/duinoapp-client src/plugins/compile-server.js
// (GPL: read for the contract only, nothing copied).

import {
  CompileError,
  type CompileRequest,
  type CompileResult,
  type FlashImage,
  type ServerInfo,
} from './types';

export const DEFAULT_COMPILE_TIMEOUT_MS = 45_000;
const INFO_TIMEOUT_MS = 10_000;

export interface RequestOptions {
  /** Caller-side cancel. Aborting rethrows the signal's reason, not a CompileError. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Builds the request for a single-file sketch, as the editor produces it. */
export function sketchRequest(code: string, fqbn: string, sketchName = 'sketch'): CompileRequest {
  return {
    fqbn,
    files: [{ name: `${sketchName}/${sketchName}.ino`, content: code }],
    flags: { verbose: false, preferLocal: false },
    libs: [],
  };
}

/**
 * Decodes base64 to bytes with `atob` (browser and Node ≥16 both have it), so the bundle
 * never needs Node's Buffer.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function endpoint(serverUrl: string, path: string): string {
  return `${serverUrl.trim().replace(/\/+$/, '')}/v3/${path}`;
}

/**
 * fetch + read the body as text under one deadline. The timeout covers the body too: a
 * server that sends headers and then stalls still times out.
 */
async function fetchText(
  url: string,
  init: RequestInit,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number },
): Promise<{ res: Response; text: string }> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    if (timedOut) {
      throw new CompileError(
        'timeout',
        `No answer from ${url} within ${Math.round(timeoutMs / 1000)} s`,
      );
    }
    if (signal?.aborted) throw signal.reason;
    // fetch rejects with a TypeError for DNS/refused/CORS failures; the browser does not
    // say which, so all of them are "network".
    const detail = err instanceof Error ? err.message : String(err);
    throw new CompileError('network', `Could not reach ${url}: ${detail}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

type Json = Record<string, unknown>;

function parseBody(text: string, res: Response): Json {
  if (!res.ok) {
    throw new CompileError('server-error', `HTTP ${res.status} ${res.statusText}`.trim(), text);
  }
  if (text.trim() === '') {
    throw new CompileError('empty-body', `Empty reply (HTTP ${res.status})`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CompileError('server-error', 'Reply is not JSON', text);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CompileError('server-error', 'Reply is not a JSON object', text);
  }
  return body as Json;
}

/** arduino-cli errors arrive as `{Cause, Message, Code}`; older paths send a plain string. */
function describeServerError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const { Cause, Message } = error as { Cause?: unknown; Message?: unknown };
    const parts = [Cause, Message].filter(
      (part): part is string => typeof part === 'string' && part !== '',
    );
    if (parts.length > 0) return parts.join(': ');
  }
  return JSON.stringify(error);
}

function decodeFirmware(data: string, log: string): Uint8Array {
  try {
    return base64ToBytes(data);
  } catch {
    throw new CompileError('server-error', 'Firmware in the reply is not valid base64', log);
  }
}

function parseImages(files: unknown, log: string): FlashImage[] | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  const images: FlashImage[] = [];
  for (const file of files) {
    const { data, address } = (file ?? {}) as { data?: unknown; address?: unknown };
    const offset = typeof address === 'string' ? Number(address) : address;
    if (typeof data !== 'string' || data === '' || typeof offset !== 'number') return null;
    if (!Number.isInteger(offset) || offset < 0) return null;
    images.push({ data: decodeFirmware(data, log), address: offset });
  }
  return images;
}

/** Interprets a parsed `/v3/compile` reply. Exported for tests; `compile()` is the API. */
export function toCompileResult(body: Json): CompileResult {
  const log = typeof body.log === 'string' ? body.log : '';

  if (body.error !== undefined && body.error !== null && body.error !== '') {
    throw new CompileError('server-error', describeServerError(body.error), log);
  }
  if (typeof body.hex === 'string' && body.hex.trim() !== '') {
    return { kind: 'avr', hex: decodeFirmware(body.hex, log), log };
  }
  const images = parseImages(body.files, log);
  if (images) {
    return {
      kind: 'esp',
      images,
      ...(typeof body.flash_freq === 'string' && body.flash_freq !== ''
        ? { flashFreq: body.flash_freq }
        : {}),
      ...(typeof body.flash_mode === 'string' && body.flash_mode !== ''
        ? { flashMode: body.flash_mode }
        : {}),
      log,
    };
  }
  // No firmware means the build failed, whatever else the reply says.
  throw new CompileError('no-firmware', 'The server sent no firmware', log);
}

/** `POST /v3/compile`. Resolves with firmware or rejects with a `CompileError`. */
export async function compile(
  serverUrl: string,
  req: CompileRequest,
  { signal, timeoutMs = DEFAULT_COMPILE_TIMEOUT_MS }: RequestOptions = {},
): Promise<CompileResult> {
  const { res, text } = await fetchText(
    endpoint(serverUrl, 'compile'),
    {
      method: 'POST',
      // JSON content type makes this a CORS preflighted request; the server answers `*`.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    { signal, timeoutMs },
  );
  return toCompileResult(parseBody(text, res));
}

/** `GET /v3/info/server`: who runs this compile server. */
export async function serverInfo(
  serverUrl: string,
  { signal, timeoutMs = INFO_TIMEOUT_MS }: RequestOptions = {},
): Promise<ServerInfo> {
  const { res, text } = await fetchText(
    endpoint(serverUrl, 'info/server'),
    { method: 'GET' },
    { signal, timeoutMs },
  );
  const body = parseBody(text, res);
  if (typeof body.name !== 'string') {
    throw new CompileError('server-error', 'Server info has no name', text);
  }
  return body as unknown as ServerInfo;
}
