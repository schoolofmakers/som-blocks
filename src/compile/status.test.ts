import { describe, expect, it } from 'vitest';
import { isTooBig, statusLine } from './status';
import { CompileError } from './types';

// arduino-cli's own wording when the app does not fit the partition (esp32 core 3.x).
const TOO_BIG_LOG = [
  'Sketch uses 1987654 bytes (101%) of program storage space. Maximum is 1966080 bytes.',
  'Sketch too big; see https://support.arduino.cc/hc/en-us/articles/360013825179 for tips on reducing it.',
  'text section exceeds available space in board',
].join('\n');

describe('statusLine', () => {
  const failed = (log: string) => ({
    status: 'error' as const,
    result: null,
    error: new CompileError('no-firmware', 'The server sent no firmware', log),
    durationMs: 12_300,
    requestUrl: 'http://127.0.0.1:3031',
  });

  it('says "demasiado grande para subir por WiFi" for an OTA build that does not fit', () => {
    expect(isTooBig(TOO_BIG_LOG)).toBe(true);
    expect(statusLine({ ...failed(TOO_BIG_LOG), ota: true }, 'es')).toBe(
      'Tu programa es demasiado grande para subir por WiFi. Hazlo más corto o desactiva «Subir por WiFi» y súbelo por cable. (Falló después de 12.3 s)',
    );
  });

  it('keeps the usual message for a cable build or another error', () => {
    expect(statusLine({ ...failed(TOO_BIG_LOG), ota: false }, 'es')).toMatch(
      /^Tu programa tiene errores/,
    );
    expect(statusLine({ ...failed("error: 'x' was not declared"), ota: true }, 'en')).toMatch(
      /^Your program has errors/,
    );
  });
});
