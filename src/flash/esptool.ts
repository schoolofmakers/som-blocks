import type { BoardDefinition, Chip } from '../boards/types';
import type { CompileResult, FlashImage } from '../compile/types';
import type { SerialSignals, Transport } from '../transport/types';
import {
  errorText,
  FlashError,
  throwIfAborted,
  type Flasher,
  type FlashHooks,
  type FlashPhase,
} from './types';

// ESP32 / ESP32-C3 / ESP8266 over Web Serial with esptool-js (Apache-2.0).
//
// Pattern: espressif/esptool-js examples/typescript/src/index.ts — `new Transport(port)`,
// `new ESPLoader({ transport, baudrate, terminal })`, `main()` to sync + detect + load the
// stub, `writeFlash({ fileArray, flashMode, flashFreq, flashSize, eraseAll: false,
// compress: true, reportProgress })`, then `after('hard_reset')` (src/esploader.ts). The
// reset sequence is esptool-js's own choice: for the C3 SuperMini's native USB-Serial/JTAG
// (VID 0x303a, PID 0x1001) it uses `UsbJtagSerialReset`, otherwise the classic DTR/RTS pulse.
// Differences: the bootloader address comes from our board registry, not from the compile
// server (see `mapImages`); flash mode/frequency/size are always `keep`, never the server's
// values (see `flashParams`: rewriting the C3 bootloader header to QIO stops it booting); the
// detected chip is checked against the selected board before anything is written; and the
// library is loaded lazily so it stays out of the main bundle.

/** esptool-js `CHIP_NAME` for each chip in our registry (undefined: not an esp chip). */
export const ESP_CHIP_NAMES: Readonly<Record<Chip, string | undefined>> = {
  esp32: 'ESP32',
  esp32c3: 'ESP32-C3',
  esp8266: 'ESP8266',
  avr: undefined,
};

/** Every ESP app/bootloader image starts with this byte (esptool `ESP_IMAGE_MAGIC`). */
export const ESP_IMAGE_MAGIC = 0xe9;
/** Default partition-table offset; the bootloader always lives below it. */
export const PARTITION_TABLE_OFFSET = 0x8000;
/**
 * Where the compile server may put the bootloader: 0x1000 (what upstream sends for every
 * esp32-family chip, wrong for the C3) or 0x0 (if the server is ever fixed).
 */
const SERVER_BOOTLOADER_ADDRESSES: ReadonlySet<number> = new Set([0x0, 0x1000]);

const FALLBACK_BAUD = 115200;
const DEFAULT_ESP_BAUD = 921600;

/**
 * The bootloader is the image the server placed at 0x0 or 0x1000 whose first byte is the ESP
 * image magic 0xE9. The address alone is not enough (it is the value we distrust); the magic
 * byte alone is not enough either (the app at 0x10000 starts with 0xE9 too); the partition
 * table (0x8000) and boot_app0 (0xe000) are above the bootloader region and never match.
 */
export function isBootloaderImage(image: FlashImage): boolean {
  return (
    SERVER_BOOTLOADER_ADDRESSES.has(image.address) &&
    image.address < PARTITION_TABLE_OFFSET &&
    image.data[0] === ESP_IMAGE_MAGIC
  );
}

const hex = (n: number) => `0x${n.toString(16)}`;

/**
 * The images to write, in esptool-js `fileArray` shape. The bootloader image moves to
 * `board.upload.bootloaderAddress` (C3: 0x0, classic ESP32: 0x1000; _config/boards.md →
 * "Bootloader address rule"); every other image keeps the address the server sent
 * (partitions 0x8000, boot_app0 0xe000, app 0x10000). A single image (ESP8266) is written as
 * sent. Anything ambiguous throws instead of guessing: a wrong flash layout bricks the boot.
 */
export function mapImages(
  images: readonly FlashImage[],
  board: Pick<BoardDefinition, 'id' | 'upload'>,
): FlashImage[] {
  if (images.length === 0) throw new FlashError('write-failed', 'the compile result has no images');
  const target = board.upload.bootloaderAddress;
  if (target === undefined) {
    if (images.length === 1) return images.map((image) => ({ ...image }));
    throw new FlashError(
      'unsupported-board',
      `${board.id}: upload.bootloaderAddress is missing from the board registry`,
    );
  }

  const bootloaders = images.filter(isBootloaderImage);
  if (bootloaders.length !== 1) {
    throw new FlashError(
      'write-failed',
      `expected one bootloader image (0xE9 at 0x0 or 0x1000), found ${bootloaders.length}: ` +
        images.map((image) => hex(image.address)).join(', '),
    );
  }
  const mapped = images.map((image) =>
    image === bootloaders[0] ? { ...image, address: target } : { ...image },
  );

  const sorted = [...mapped].sort((a, b) => a.address - b.address);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    if (prev.address + prev.data.byteLength > next.address) {
      throw new FlashError(
        'write-failed',
        `image at ${hex(prev.address)} (${prev.data.byteLength} bytes) overlaps ${hex(next.address)}`,
      );
    }
  }
  return mapped;
}

/**
 * Flash parameters for esptool-js: always `keep`, whatever the compile server reports.
 *
 * Hardware evidence (ESP32-C3 SuperMini, 2026-10-17): passing the server's `qio` / `80m`
 * made esptool-js rewrite the bootloader header at 0x0 to QIO, and the ROM could not load the
 * second-stage bootloader: `mode:QIO, clock div:1 … ets_loader.c 78`, then a TG0WDT reset loop.
 * The server's values come from `build.boot`; arduino-esp32 deliberately builds the C3
 * bootloader header as DIO even for the QIO menu entry (boards.txt
 * `menu.FlashMode.qio.build.flash_mode=dio`, `build.boot=qio`; the bootloader switches to QIO
 * itself), and its upload recipe passes `--flash_mode keep --flash_freq keep --flash_size
 * keep`. So do we: the images already carry the right header. The server's values are only
 * logged.
 */
export function flashParams(): { flashMode: 'keep'; flashFreq: 'keep'; flashSize: 'keep' } {
  return { flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep' };
}

/**
 * Overall write percentage across all images. esptool-js reports `(fileIndex, written,
 * total)` per image, in compressed bytes; each image weighs by its uncompressed size.
 */
export function writePercent(
  sizes: readonly number[],
  fileIndex: number,
  written: number,
  total: number,
): number {
  const all = sizes.reduce((sum, size) => sum + size, 0);
  if (all === 0) return 100;
  const before = sizes.slice(0, fileIndex).reduce((sum, size) => sum + size, 0);
  const fraction = total > 0 ? Math.min(written / total, 1) : 1;
  const done = before + (sizes[fileIndex] ?? 0) * fraction;
  return Math.round((100 * done) / all);
}

/** esptool-js `IEspLoaderTerminal` that hands complete lines to `onLog`. */
function lineTerminal(onLog: (line: string) => void) {
  let partial = '';
  const emit = (text: string) => {
    for (const line of text.split(/\r?\n|\r/)) if (line.trim() !== '') onLog(line);
  };
  return {
    clean() {},
    write(data: string) {
      partial += data;
      const lastBreak = Math.max(partial.lastIndexOf('\n'), partial.lastIndexOf('\r'));
      if (lastBreak >= 0) {
        emit(partial.slice(0, lastBreak));
        partial = partial.slice(lastBreak + 1);
      }
    },
    writeLine(data: string) {
      emit(partial + data);
      partial = '';
    },
    flush() {
      emit(partial);
      partial = '';
    },
  };
}

interface SignalPort {
  setSignals(signals: SerialSignals): Promise<void>;
}

/** RTS high this long resets the chip (esptool.py HardReset: setRTS(True); sleep(0.1)). */
export const RESET_PULSE_MS = 100;

/**
 * Resets the chip out of the flasher stub so the new program runs, on the raw port we still
 * hold: DTR low (GPIO9/IO0 high: normal boot), RTS high (EN/CHIP_PU low), 100 ms, RTS low.
 *
 * Why not esptool-js alone: 0.7's `HardReset.reset()` only does `sleep(100); setRTS(false)`,
 * relying on RTS still being high from the connect sequence. On the C3's native
 * USB-Serial/JTAG, `UsbJtagSerialReset` ends with RTS and DTR low, so "Hard resetting via RTS
 * pin..." changes nothing and the chip stays in the stub until the student presses RESET
 * (seen on a real SuperMini). esptool.py's HardReset asserts RTS first; we do the same, for
 * every esp chip (on classic auto-reset circuits it is the same EN pulse). The C3 then
 * re-enumerates; the transport store finds it again (store.ts `reconnect`).
 */
export async function resetIntoApp(port: SignalPort, onLog: (line: string) => void) {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise((resolve) => setTimeout(resolve, RESET_PULSE_MS));
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    onLog('reset → running your program');
  } catch (error) {
    // The chip may already have reset and left the bus; the program runs either way.
    onLog(`reset: ${errorText(error)}`);
  }
}

type EspModule = typeof import('esptool-js');
type EspTransport = InstanceType<EspModule['Transport']>;
type EspLoader = InstanceType<EspModule['ESPLoader']>;

async function disconnectQuietly(transport: EspTransport | undefined): Promise<void> {
  try {
    await transport?.disconnect();
  } catch {
    // Already closed (open failed) or the device is gone; nothing left to release.
  }
}

const PORT_LOST = /device has been lost|NetworkError|Failed to open|disconnected|not open/i;

function connectError(esp: EspModule, error: unknown): FlashError {
  if (error instanceof FlashError) return error;
  if (error instanceof esp.UnexpectedChipIdError || error instanceof esp.UnexpectedChipMagicError) {
    return new FlashError('wrong-chip', errorText(error));
  }
  if (PORT_LOST.test(errorText(error))) return new FlashError('transport', errorText(error));
  return new FlashError('sync-failed', errorText(error));
}

function writeError(error: unknown): FlashError {
  if (error instanceof FlashError) return error;
  const text = errorText(error);
  if (/MD5/i.test(text)) return new FlashError('verify-failed', text);
  if (PORT_LOST.test(text)) return new FlashError('transport', text);
  return new FlashError('write-failed', text);
}

/**
 * Sync at the board's upload baud, then once more at 115200. esptool-js always syncs with the
 * ROM at 115200 and only then switches to `baudrate`, so the retry helps when the switch to the
 * fast rate fails (long cables, slow USB-UART bridges), not when the ROM does not answer.
 */
async function connect(
  esp: EspModule,
  port: unknown,
  board: BoardDefinition,
  terminal: ReturnType<typeof lineTerminal>,
  hooks: FlashHooks,
): Promise<{ loader: EspLoader; espTransport: EspTransport }> {
  const preferred = board.upload.baud ?? DEFAULT_ESP_BAUD;
  const bauds = preferred === FALLBACK_BAUD ? [preferred] : [preferred, FALLBACK_BAUD];
  let last: FlashError | undefined;
  for (const baud of bauds) {
    throwIfAborted(hooks.signal);
    const espTransport = new esp.Transport(port as never, false);
    const loader = new esp.ESPLoader({ transport: espTransport, baudrate: baud, terminal });
    try {
      await loader.main();
      return { loader, espTransport };
    } catch (error) {
      await disconnectQuietly(espTransport);
      last = connectError(esp, error);
      if (last.code !== 'sync-failed') throw last;
      hooks.onLog(`connect at ${baud} baud failed: ${last.detail ?? last.message}`);
    }
  }
  throw last ?? new FlashError('sync-failed');
}

export const esptoolFlasher: Flasher = {
  supportsCancel: true,

  async flash(result: CompileResult, board: BoardDefinition, transport: Transport, hooks) {
    if (result.kind !== 'esp') {
      throw new FlashError(
        'unsupported-board',
        `${board.id} needs an esp build, got ${result.kind}`,
      );
    }
    const expectedChip = ESP_CHIP_NAMES[board.chip];
    if (!expectedChip) throw new FlashError('unsupported-board', `${board.id}: chip ${board.chip}`);
    // Validate the layout before touching the port: a bad layout must not cost a reset.
    const fileArray = mapImages(result.images, board);
    const port = transport.nativePort;
    if (transport.kind !== 'web-serial' || !port) throw new FlashError('no-port');
    throwIfAborted(hooks.signal);

    // esptool-js opens the raw port itself: our transport must release it first.
    await transport.close();
    const esp = await import('esptool-js');
    const terminal = lineTerminal(hooks.onLog);
    let phase: FlashPhase = 'connect';
    let espTransport: EspTransport | undefined;
    try {
      hooks.onProgress({ phase, percent: 0 });
      const connected = await connect(esp, port, board, terminal, hooks);
      espTransport = connected.espTransport;
      const { loader } = connected;

      const found = loader.chip.CHIP_NAME;
      if (found !== expectedChip) {
        throw new FlashError('wrong-chip', `found ${found}, the selected board is ${expectedChip}`);
      }
      const chipOffset = (loader.chip as { BOOTLOADER_FLASH_OFFSET?: number })
        .BOOTLOADER_FLASH_OFFSET;
      if (
        board.upload.bootloaderAddress !== undefined &&
        chipOffset !== undefined &&
        chipOffset !== board.upload.bootloaderAddress
      ) {
        throw new FlashError(
          'unsupported-board',
          `${board.id}: registry bootloader ${hex(board.upload.bootloaderAddress)} but ` +
            `${found} boots from ${hex(chipOffset)}`,
        );
      }
      throwIfAborted(hooks.signal);

      phase = 'write';
      hooks.onProgress({ phase, percent: 0 });
      const sizes = fileArray.map((image) => image.data.byteLength);
      hooks.onLog(
        `flash params: keep (server reported mode ${result.flashMode ?? '-'}, ` +
          `freq ${result.flashFreq ?? '-'}; images keep their own headers)`,
      );
      await loader.writeFlash({
        fileArray,
        ...flashParams(),
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          // Throwing here stops writeFlash between blocks: that is how Cancel works.
          throwIfAborted(hooks.signal);
          hooks.onProgress({
            phase: 'write',
            percent: writePercent(sizes, fileIndex, written, total),
          });
        },
      });

      phase = 'reset';
      hooks.onProgress({ phase, percent: 100 });
      await loader.after('hard_reset');
      await resetIntoApp(port as SignalPort, hooks.onLog);
      hooks.onProgress({ phase: 'done', percent: 100 });
    } catch (error) {
      throw phase === 'connect' ? connectError(esp, error) : writeError(error);
    } finally {
      terminal.flush();
      await disconnectQuietly(espTransport);
    }
  },
};
