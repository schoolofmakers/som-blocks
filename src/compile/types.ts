// Types for the compile-server contract (duinoapp-server v3, see _config/architecture.md →
// "Compile server API").

export interface CompileFile {
  /** `<sketch>/<sketch>.ino` — arduino-cli needs the folder and file names to match. */
  name: string;
  content: string;
}

/** Library entries must be objects with a zip `url`; a bare string crashes the server. */
export interface CompileLib {
  name: string;
  url: string;
  version: string;
}

export interface CompileRequest {
  fqbn: string;
  files: CompileFile[];
  flags: { verbose: boolean; preferLocal: boolean };
  libs: CompileLib[];
}

export interface FlashImage {
  data: Uint8Array;
  address: number;
}

/** AVR boards: the server returns the Intel HEX *text*, base64-encoded; `hex` holds its bytes. */
export interface AvrCompileResult {
  kind: 'avr';
  hex: Uint8Array;
  log: string;
}

/** ESP boards: raw binary images with their flash offsets (esp32: 4 images, esp8266: 1). */
export interface EspCompileResult {
  kind: 'esp';
  images: FlashImage[];
  flashFreq?: string;
  flashMode?: string;
  log: string;
}

export type CompileResult = AvrCompileResult | EspCompileResult;

export type CompileErrorCause =
  'server-error' | 'no-firmware' | 'timeout' | 'network' | 'empty-body';

export class CompileError extends Error {
  // Narrows Error.cause (ES2022) to the failure kinds the UI explains.
  override cause: CompileErrorCause;
  /** Whatever arduino-cli output the server sent back (empty when it sent none). */
  log: string;

  constructor(cause: CompileErrorCause, message: string, log = '') {
    super(message);
    this.name = 'CompileError';
    this.cause = cause;
    this.log = log;
  }
}

/** `GET /v3/info/server`. */
export interface ServerInfo {
  name: string;
  location?: string;
  country?: string;
  owner?: string;
  website?: string;
  description?: string;
}

/** Firmware size in bytes (AVR: Intel HEX text; ESP: sum of the images). */
export function firmwareBytes(result: CompileResult): number {
  return result.kind === 'avr'
    ? result.hex.byteLength
    : result.images.reduce((sum, image) => sum + image.data.byteLength, 0);
}
