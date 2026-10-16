import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes, compile, serverInfo, sketchRequest } from './client';
import { CompileError, firmwareBytes, type CompileResult } from './types';

const SERVER = 'http://compile.test/';
const req = sketchRequest('void setup() {}\nvoid loop() {}\n', 'arduino:avr:uno');

// Two records of a real Intel HEX file: the server sends this text base64-encoded.
const HEX_TEXT = ':100000000C945C000C946E000C946E000C946E00CA\n:00000001FF\n';
const b64 = (text: string) => btoa(text);

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

function reply(body: string, init: ResponseInit = { status: 200 }) {
  fetchMock.mockResolvedValueOnce(new Response(body, init));
}

async function compileError(promise: Promise<CompileResult>): Promise<CompileError> {
  const err = await promise.then(
    () => {
      throw new Error('expected compile() to reject');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CompileError);
  return err as CompileError;
}

describe('compile()', () => {
  it('POSTs the request as JSON to /v3/compile', async () => {
    reply(JSON.stringify({ hex: b64(HEX_TEXT), log: '' }));
    await compile(SERVER, req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://compile.test/v3/compile');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      fqbn: 'arduino:avr:uno',
      files: [{ name: 'sketch/sketch.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
      flags: { verbose: false, preferLocal: false },
      libs: [],
    });
  });

  it('decodes an AVR reply into the Intel HEX bytes', async () => {
    const log = 'Sketch uses 924 bytes (2%) of program storage space.\n';
    reply(JSON.stringify({ hex: b64(HEX_TEXT), log }));
    const result = await compile(SERVER, req);
    expect(result.kind).toBe('avr');
    if (result.kind !== 'avr') return;
    expect(new TextDecoder().decode(result.hex)).toBe(HEX_TEXT);
    expect(firmwareBytes(result)).toBe(HEX_TEXT.length);
    expect(result.log).toBe(log);
  });

  it('decodes an esp32 reply into 4 images with addresses and flash settings', async () => {
    const images = [
      { data: b64('app0'), address: 0xe000 },
      { data: b64('boot-loader'), address: 0 },
      { data: btoa(String.fromCharCode(0xe9, 0x00, 0xff, 0x80)), address: 0x10000 },
      { data: b64('parts'), address: 0x8000 },
    ];
    reply(JSON.stringify({ files: images, flash_freq: '80m', flash_mode: 'qio', log: 'ok\n' }));
    const result = await compile(SERVER, { ...req, fqbn: 'esp32:esp32:esp32c3:CDCOnBoot=cdc' });
    expect(result.kind).toBe('esp');
    if (result.kind !== 'esp') return;
    expect(result.images.map((i) => i.address)).toEqual([0xe000, 0, 0x10000, 0x8000]);
    expect(Array.from(result.images[2]!.data)).toEqual([0xe9, 0x00, 0xff, 0x80]);
    expect(new TextDecoder().decode(result.images[1]!.data)).toBe('boot-loader');
    expect(result.flashFreq).toBe('80m');
    expect(result.flashMode).toBe('qio');
    expect(firmwareBytes(result)).toBe(4 + 11 + 4 + 5);
  });

  it('treats a reply with only {log} (gcc failure) as no-firmware and keeps the log', async () => {
    const log =
      "sketch.ino: In function 'void loop()':\nsketch.ino:3:1: error: expected ';' before '}' token\n";
    reply(JSON.stringify({ log }));
    const err = await compileError(compile(SERVER, req));
    expect(err.cause).toBe('no-firmware');
    expect(err.log).toBe(log);
  });

  it('treats empty firmware fields as no-firmware', async () => {
    reply(JSON.stringify({ hex: '', files: [], log: 'x' }));
    expect((await compileError(compile(SERVER, req))).cause).toBe('no-firmware');
  });

  it('surfaces {error: {Cause, Message}} as server-error', async () => {
    reply(
      JSON.stringify({
        error: { Cause: 'Invalid FQBN', Message: 'not found: foo:bar:baz', Code: 4 },
        log: 'Error during build\n',
      }),
    );
    const err = await compileError(compile(SERVER, req));
    expect(err.cause).toBe('server-error');
    expect(err.message).toBe('Invalid FQBN: not found: foo:bar:baz');
    expect(err.log).toBe('Error during build\n');
  });

  it('surfaces a non-2xx status as server-error with the body as log', async () => {
    reply('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    const err = await compileError(compile(SERVER, req));
    expect(err.cause).toBe('server-error');
    expect(err.message).toBe('HTTP 502 Bad Gateway');
    expect(err.log).toBe('Bad Gateway');
  });

  it('reports a 200 with an empty body as empty-body', async () => {
    reply('');
    expect((await compileError(compile(SERVER, req))).cause).toBe('empty-body');
  });

  it('reports non-JSON as server-error with the raw text as log', async () => {
    reply('<html>oops</html>');
    const err = await compileError(compile(SERVER, req));
    expect(err.cause).toBe('server-error');
    expect(err.log).toBe('<html>oops</html>');
  });

  it('reports a fetch rejection as network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await compileError(compile(SERVER, req));
    expect(err.cause).toBe('network');
    expect(err.message).toContain('Failed to fetch');
  });

  it('aborts and reports timeout when the server never answers', async () => {
    vi.useFakeTimers();
    let seenSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          seenSignal = init?.signal ?? undefined;
          seenSignal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = compileError(compile(SERVER, req, { timeoutMs: 30_000 }));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(seenSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await pending;
    expect(seenSignal?.aborted).toBe(true);
    expect(err.cause).toBe('timeout');
  });

  it('rethrows a caller abort instead of mapping it to a CompileError', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const pending = compile(SERVER, req, { signal: controller.signal });
    controller.abort(new DOMException('user cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('base64ToBytes()', () => {
  it('decodes every byte value without Node Buffer', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    const encoded = btoa(String.fromCharCode(...all));
    expect(Array.from(base64ToBytes(encoded))).toEqual(all);
  });

  it('ignores line breaks in the base64 text', () => {
    expect(new TextDecoder().decode(base64ToBytes('aGVs\nbG8='))).toBe('hello');
  });
});

describe('serverInfo()', () => {
  it('returns the server description', async () => {
    reply(JSON.stringify({ name: 'som-compile', country: 'CL' }));
    const info = await serverInfo('http://compile.test');
    expect(info).toEqual({ name: 'som-compile', country: 'CL' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://compile.test/v3/info/server');
  });

  it('rejects a reply without a name', async () => {
    reply(JSON.stringify({}));
    await expect(serverInfo('http://compile.test')).rejects.toBeInstanceOf(CompileError);
  });
});
