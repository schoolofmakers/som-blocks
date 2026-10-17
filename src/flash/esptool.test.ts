import { beforeEach, describe, expect, it, vi } from 'vitest';
import { esp32c3SuperMini } from '../boards/definitions/esp32c3-supermini';
import type { BoardDefinition } from '../boards/types';
import type { EspCompileResult, FlashImage } from '../compile/types';
import { fakeTransport } from '../test/fake-transport';
import { esptoolFlasher, flashParams, isBootloaderImage, mapImages, writePercent } from './esptool';
import { FlashError, type FlashProgress } from './types';

// esptool-js is mocked: no hardware in unit tests. The mock keeps the shape the flasher uses
// (Transport, ESPLoader.main/writeFlash/after, chip.CHIP_NAME, the chip-id error classes).
const h = vi.hoisted(() => {
  type Options = { baudrate: number; terminal: { writeLine(s: string): void } };
  type WriteOptions = {
    fileArray: { data: Uint8Array; address: number }[];
    flashMode: string;
    flashFreq: string;
    reportProgress?: (fileIndex: number, written: number, total: number) => void;
  };
  return {
    chipName: 'ESP32-C3',
    bootOffset: 0 as number | undefined,
    loaders: [] as Options[],
    disconnects: 0,
    /** Delay of esptool-js's Transport.disconnect() (the raw port's close). */
    disconnectDelayMs: 0,
    disconnectedAt: 0,
    main: vi.fn<(options: Options) => Promise<string>>(),
    writeFlash: vi.fn<(options: WriteOptions) => Promise<void>>(),
    after: vi.fn<(mode: string) => Promise<void>>(),
  };
});

vi.mock('esptool-js', () => {
  class UnexpectedChipIdError extends Error {}
  class UnexpectedChipMagicError extends Error {}
  class Transport {
    async disconnect() {
      if (h.disconnectDelayMs) await new Promise((r) => setTimeout(r, h.disconnectDelayMs));
      h.disconnectedAt = performance.now();
      h.disconnects += 1;
    }
  }
  class ESPLoader {
    readonly chip = { CHIP_NAME: h.chipName, BOOTLOADER_FLASH_OFFSET: h.bootOffset };
    readonly options: { baudrate: number; terminal: { writeLine(s: string): void } };
    constructor(options: { baudrate: number; terminal: { writeLine(s: string): void } }) {
      this.options = options;
      h.loaders.push(options);
    }
    main() {
      return h.main(this.options);
    }
    writeFlash(options: Parameters<typeof h.writeFlash>[0]) {
      return h.writeFlash(options);
    }
    after(mode: string) {
      return h.after(mode);
    }
  }
  return { Transport, ESPLoader, UnexpectedChipIdError, UnexpectedChipMagicError };
});

/** `size` bytes, first byte `first`. */
function bytes(size: number, first: number): Uint8Array {
  const data = new Uint8Array(size).fill(0xff);
  data[0] = first;
  return data;
}

// The shape of a real C3 compile response (core 3.3.12): the bootloader comes at 0x1000.
function c3Images(): FlashImage[] {
  return [
    { address: 0x1000, data: bytes(20_000, 0xe9) }, // bootloader (mislabelled)
    { address: 0x8000, data: bytes(3_072, 0xaa) }, // partition table (magic 0xAA 0x50)
    { address: 0xe000, data: bytes(8_192, 0x00) }, // boot_app0
    { address: 0x10000, data: bytes(250_000, 0xe9) }, // app
  ];
}

const classicEsp32: BoardDefinition = {
  ...esp32c3SuperMini,
  id: 'esp32-dev',
  chip: 'esp32',
  upload: { tool: 'esptool', baud: 921600, bootloaderAddress: 0x1000 },
};

function c3Result(images = c3Images()): EspCompileResult {
  return { kind: 'esp', images, flashMode: 'qio', flashFreq: '80m', log: '' };
}

describe('mapImages', () => {
  it('C3: moves the bootloader from the server 0x1000 to the registry 0x0, keeps the rest', () => {
    const mapped = mapImages(c3Images(), esp32c3SuperMini);
    expect(mapped.map((image) => image.address)).toEqual([0x0, 0x8000, 0xe000, 0x10000]);
    expect(mapped[0]!.data.byteLength).toBe(20_000);
    expect(mapped[3]!.data.byteLength).toBe(250_000);
  });

  it('classic ESP32 keeps the bootloader at 0x1000', () => {
    const mapped = mapImages(c3Images(), classicEsp32);
    expect(mapped.map((image) => image.address)).toEqual([0x1000, 0x8000, 0xe000, 0x10000]);
  });

  it('a server that already sends 0x0 still maps to the registry address', () => {
    const images = c3Images();
    images[0] = { ...images[0]!, address: 0x0 };
    expect(mapImages(images, esp32c3SuperMini)[0]!.address).toBe(0x0);
    expect(mapImages(images, classicEsp32)[0]!.address).toBe(0x1000);
  });

  it('identifies the bootloader by address AND magic byte, not by address alone', () => {
    const [boot, partitions, bootApp0, app] = c3Images();
    expect(isBootloaderImage(boot!)).toBe(true);
    // The app starts with 0xE9 too, but sits above the bootloader region.
    expect(isBootloaderImage(app!)).toBe(false);
    expect(isBootloaderImage(partitions!)).toBe(false);
    expect(isBootloaderImage(bootApp0!)).toBe(false);
    // Something at 0x1000 that is not an ESP image is not the bootloader.
    expect(isBootloaderImage({ address: 0x1000, data: bytes(100, 0x00) })).toBe(false);
  });

  it('refuses when the bootloader cannot be identified (no magic at 0x1000)', () => {
    const images = c3Images();
    images[0] = { ...images[0]!, data: bytes(20_000, 0x00) };
    expect(() => mapImages(images, esp32c3SuperMini)).toThrow(/expected one bootloader image/);
  });

  it('refuses two bootloader candidates instead of guessing', () => {
    const images = [{ address: 0x0, data: bytes(1_000, 0xe9) }, ...c3Images()];
    expect(() => mapImages(images, esp32c3SuperMini)).toThrow(/found 2/);
  });

  it('missing bootloaderAddress on a multi-image board is an error', () => {
    const board = { ...esp32c3SuperMini, upload: { tool: 'esptool' as const, baud: 921600 } };
    try {
      mapImages(c3Images(), board);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FlashError);
      expect((error as FlashError).code).toBe('unsupported-board');
      expect((error as FlashError).detail).toMatch(/bootloaderAddress is missing/);
    }
  });

  it('a single image (ESP8266) is written as sent, with or without bootloaderAddress', () => {
    const board = { ...esp32c3SuperMini, upload: { tool: 'esptool' as const } };
    const images = [{ address: 0x0, data: bytes(300_000, 0xe9) }];
    expect(mapImages(images, board)).toEqual(images);
  });

  it('refuses a layout where the moved bootloader would overlap the next image', () => {
    const images = c3Images();
    images[0] = { ...images[0]!, data: bytes(0x9000, 0xe9) }; // 36 KiB from 0x0 runs into 0x8000
    expect(() => mapImages(images, esp32c3SuperMini)).toThrow(/overlaps 0x8000/);
  });

  it('refuses an empty result', () => {
    expect(() => mapImages([], esp32c3SuperMini)).toThrow(/no images/);
  });
});

describe('flashParams', () => {
  it('passes the server values through and falls back to keep', () => {
    expect(flashParams({ flashMode: 'qio', flashFreq: '80m' })).toEqual({
      flashMode: 'qio',
      flashFreq: '80m',
    });
    expect(flashParams({ flashFreq: '40' })).toEqual({ flashMode: 'keep', flashFreq: '40m' });
    expect(flashParams({ flashMode: 'weird', flashFreq: '' })).toEqual({
      flashMode: 'keep',
      flashFreq: 'keep',
    });
  });
});

describe('writePercent', () => {
  it('weighs each image by its size across the whole upload', () => {
    const sizes = [100, 300];
    expect(writePercent(sizes, 0, 0, 50)).toBe(0);
    expect(writePercent(sizes, 0, 50, 50)).toBe(25);
    expect(writePercent(sizes, 1, 0, 80)).toBe(25);
    expect(writePercent(sizes, 1, 40, 80)).toBe(63);
    expect(writePercent(sizes, 1, 80, 80)).toBe(100);
  });

  it('never goes past 100 or divides by zero', () => {
    expect(writePercent([10], 0, 20, 10)).toBe(100);
    expect(writePercent([10], 0, 0, 0)).toBe(100);
    expect(writePercent([], 0, 0, 0)).toBe(100);
  });
});

describe('esptoolFlasher.flash', () => {
  beforeEach(() => {
    h.chipName = 'ESP32-C3';
    h.bootOffset = 0;
    h.loaders.length = 0;
    h.disconnects = 0;
    h.disconnectDelayMs = 0;
    h.disconnectedAt = 0;
    h.main.mockReset().mockImplementation(async ({ terminal }) => {
      terminal.writeLine('Chip is ESP32-C3 (QFN32) (revision v0.4)');
      return 'ESP32-C3';
    });
    h.writeFlash.mockReset().mockImplementation(async ({ fileArray, reportProgress }) => {
      fileArray.forEach((_, i) => {
        reportProgress?.(i, 0, 10);
        reportProgress?.(i, 10, 10);
      });
    });
    h.after.mockReset().mockResolvedValue(undefined);
  });

  function run(result = c3Result(), board: BoardDefinition = esp32c3SuperMini) {
    const transport = fakeTransport();
    const progress: FlashProgress[] = [];
    const log: string[] = [];
    const controller = new AbortController();
    const promise = esptoolFlasher.flash(result, board, transport, {
      onProgress: (p) => progress.push(p),
      onLog: (line) => log.push(line),
      signal: controller.signal,
    });
    return { promise, transport, progress, log, controller };
  }

  it('closes our transport first, writes the remapped images, hard-resets and lets go', async () => {
    const { promise, transport, progress, log } = run();
    await promise;
    expect(transport.close).toHaveBeenCalled();
    expect(transport.close.mock.invocationCallOrder[0]!).toBeLessThan(
      h.main.mock.invocationCallOrder[0]!,
    );
    expect(h.loaders[0]!.baudrate).toBe(921600);
    const options = h.writeFlash.mock.calls[0]![0];
    expect(options.fileArray.map((f) => f.address)).toEqual([0x0, 0x8000, 0xe000, 0x10000]);
    expect(options).toMatchObject({
      flashMode: 'qio',
      flashFreq: '80m',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
    });
    expect(h.after).toHaveBeenCalledWith('hard_reset');
    expect(h.disconnects).toBe(1);
    expect(progress[0]).toEqual({ phase: 'connect', percent: 0 });
    expect(progress.at(-1)).toEqual({ phase: 'done', percent: 100 });
    expect(progress.filter((p) => p.phase === 'write').map((p) => p.percent)).toContain(100);
    expect(log).toContain('Chip is ESP32-C3 (QFN32) (revision v0.4)');
  });

  it('a different chip than the selected board is wrong-chip and nothing is written', async () => {
    h.chipName = 'ESP32';
    const { promise } = run();
    await expect(promise).rejects.toMatchObject({ code: 'wrong-chip' });
    expect(h.writeFlash).not.toHaveBeenCalled();
    expect(h.disconnects).toBe(1);
  });

  it('refuses when the chip boots from another offset than the registry says', async () => {
    h.bootOffset = 0x1000;
    await expect(run().promise).rejects.toMatchObject({ code: 'unsupported-board' });
    expect(h.writeFlash).not.toHaveBeenCalled();
  });

  it('retries the sync at 115200 once, then reports sync-failed', async () => {
    h.main.mockRejectedValue(new Error('Failed to connect with the device'));
    const { promise, log } = run();
    await expect(promise).rejects.toMatchObject({ code: 'sync-failed' });
    expect(h.loaders.map((l) => l.baudrate)).toEqual([921600, 115200]);
    expect(h.disconnects).toBe(2);
    expect(log.some((line) => line.includes('connect at 921600 baud failed'))).toBe(true);
  });

  it('the 115200 retry can succeed', async () => {
    h.main.mockRejectedValueOnce(new Error('Failed to connect with the device'));
    await run().promise;
    expect(h.loaders.map((l) => l.baudrate)).toEqual([921600, 115200]);
    expect(h.writeFlash).toHaveBeenCalledTimes(1);
  });

  it('a port that will not open is a transport error, not a sync failure', async () => {
    h.main.mockRejectedValue(new DOMException('Failed to open serial port.', 'NetworkError'));
    await expect(run().promise).rejects.toMatchObject({ code: 'transport' });
    expect(h.loaders).toHaveLength(1);
  });

  it('a write that breaks off is write-failed; an unplug is transport', async () => {
    h.writeFlash.mockRejectedValueOnce(new Error('Timeout'));
    await expect(run().promise).rejects.toMatchObject({ code: 'write-failed' });
    h.writeFlash.mockRejectedValueOnce(new DOMException('The device has been lost.'));
    await expect(run().promise).rejects.toMatchObject({ code: 'transport' });
  });

  it('cancel during the write stops between blocks and still lets go of the port', async () => {
    const { promise, controller } = run();
    h.writeFlash.mockImplementation(async ({ reportProgress }) => {
      reportProgress?.(0, 0, 10);
      controller.abort();
      reportProgress?.(0, 5, 10);
    });
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.after).not.toHaveBeenCalled();
    expect(h.disconnects).toBe(1);
  });

  it('an avr result or a non-esp board is unsupported-board before the port is touched', async () => {
    const transport = fakeTransport();
    const hooks = { onProgress: () => {}, onLog: () => {} };
    await expect(
      esptoolFlasher.flash(
        { kind: 'avr', hex: new Uint8Array(), log: '' },
        esp32c3SuperMini,
        transport,
        hooks,
      ),
    ).rejects.toMatchObject({ code: 'unsupported-board' });
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('awaits the raw port close (esptool-js disconnect) before handing the port back', async () => {
    h.disconnectDelayMs = 200;
    await run().promise;
    const returnedAt = performance.now();
    expect(h.disconnects).toBe(1);
    expect(h.disconnectedAt).toBeGreaterThan(0);
    expect(returnedAt).toBeGreaterThanOrEqual(h.disconnectedAt);
  });

  it('a transport without a native port is no-port', async () => {
    const transport = { ...fakeTransport(), nativePort: undefined };
    const hooks = { onProgress: () => {}, onLog: () => {} };
    await expect(
      esptoolFlasher.flash(c3Result(), esp32c3SuperMini, transport, hooks),
    ).rejects.toMatchObject({ code: 'no-port' });
  });
});
