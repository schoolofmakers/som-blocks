import { describe, expect, it } from 'vitest';
import { BOARDS, DEFAULT_BOARD_ID, boardLabel, getBoard, isBoardId } from './registry';
import { fullFqbn } from './types';

const ESP_CHIPS = new Set(['esp32', 'esp32c3', 'esp8266']);
// arduino-cli: `vendor:arch:board[:opt=val[,opt=val]...]` (pkg/fqbn/fqbn.go).
const FQBN_BASE = /^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/;
const FQBN_FULL =
  /^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+(:[A-Za-z0-9._-]+=[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+=[A-Za-z0-9._-]+)*)?$/;

describe('board registry data', () => {
  it('has unique ids and includes the default board', () => {
    const ids = BOARDS.map((board) => board.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_BOARD_ID);
    expect(DEFAULT_BOARD_ID).toBe('esp32c3-supermini');
  });

  it.each(BOARDS)('$id: well-formed fqbn, upload and usb data', (board) => {
    expect(board.fqbn).toMatch(FQBN_BASE);
    expect(fullFqbn(board)).toMatch(FQBN_FULL);
    expect(board.name.length).toBeGreaterThan(0);
    expect(board.usbFilters.length).toBeGreaterThan(0);
    for (const filter of board.usbFilters) {
      expect(Number.isInteger(filter.usbVendorId)).toBe(true);
      expect(filter.usbVendorId).toBeGreaterThan(0);
      expect(filter.usbVendorId).toBeLessThanOrEqual(0xffff);
    }
    if (ESP_CHIPS.has(board.chip)) {
      expect(board.upload.tool).toBe('esptool');
      expect(typeof board.upload.bootloaderAddress).toBe('number');
    } else {
      expect(board.upload.tool).toBe('avrgirl');
      expect(board.upload.avrgirlBoard).toBeDefined();
      expect(board.upload.bootloaderAddress).toBeUndefined();
    }
  });

  it.each(BOARDS)('$id: every pin label and value is a non-empty string', (board) => {
    const { digital, analog, pwm, builtinLed, analogMax } = board.pins;
    for (const [label, value] of [...digital, ...analog, ...pwm]) {
      expect(typeof label).toBe('string');
      expect(typeof value).toBe('string');
      expect(label).not.toBe('');
      expect(value).not.toBe('');
    }
    expect(digital.length).toBeGreaterThan(0);
    expect(analog.length).toBeGreaterThan(0);
    expect(typeof builtinLed).toBe('string');
    expect(digital.map(([, value]) => value)).toContain(builtinLed);
    expect([1023, 4095]).toContain(analogMax);
  });

  it('PWM pins are digital pins', () => {
    for (const board of BOARDS) {
      const digital = new Set(board.pins.digital.map(([, value]) => value));
      for (const [, value] of board.pins.pwm) expect(digital.has(value)).toBe(true);
    }
  });

  it('encodes the facts from _config/boards.md', () => {
    const c3 = getBoard('esp32c3-supermini');
    expect(c3.upload.bootloaderAddress).toBe(0x0);
    expect(c3.pins.builtinLed).toBe('8');
    expect(c3.pins.builtinLedActiveLow).toBe(true);
    expect(c3.pins.digital.map(([, v]) => v)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '20',
      '21',
    ]);
    expect(c3.pins.analog.map(([, v]) => v)).toEqual(['0', '1', '2', '3', '4']);
    expect(c3.usbFilters).toEqual([{ usbVendorId: 0x303a }]);

    const uno = getBoard('uno');
    expect(uno.upload).toEqual({ tool: 'avrgirl', avrgirlBoard: 'uno', baud: 115200 });
    expect(uno.pins.pwm.map(([, v]) => v)).toEqual(['3', '5', '6', '9', '10', '11']);
    expect(uno.pins.analog.map(([, v]) => v)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);

    const nano = getBoard('nano-old');
    expect(nano.upload).toEqual({ tool: 'avrgirl', avrgirlBoard: 'nano', baud: 57600 });
    expect(nano.pins.analog.map(([, v]) => v)).toContain('A7');
    expect(nano.pins.digital.map(([, v]) => v)).not.toContain('A7');
  });
});

describe('fullFqbn', () => {
  it('appends the C3 CDCOnBoot option', () => {
    expect(fullFqbn(getBoard('esp32c3-supermini'))).toBe('esp32:esp32:esp32c3:CDCOnBoot=cdc');
  });

  it('selects the NANO old bootloader', () => {
    expect(fullFqbn(getBoard('nano-old'))).toBe('arduino:avr:nano:cpu=atmega328old');
  });

  it('leaves a board without options bare', () => {
    expect(fullFqbn(getBoard('uno'))).toBe('arduino:avr:uno');
  });

  it('joins several options with commas in one segment, never extra colons', () => {
    const fqbn = fullFqbn({
      fqbn: 'esp32:esp32:esp32c3',
      options: { CDCOnBoot: 'cdc', PartitionScheme: 'default' },
    });
    expect(fqbn).toBe('esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=default');
    expect(fqbn.split(':')).toHaveLength(4);
  });
});

describe('getBoard / isBoardId / boardLabel', () => {
  it('falls back to the default board for an unknown id', () => {
    expect(getBoard('mega-that-was-removed').id).toBe(DEFAULT_BOARD_ID);
    expect(isBoardId('mega-that-was-removed')).toBe(false);
    expect(isBoardId(42)).toBe(false);
    expect(isBoardId('uno')).toBe(true);
  });

  it('keeps product names and translates the variant', () => {
    expect(boardLabel(getBoard('uno'), 'en')).toBe('Arduino UNO');
    expect(boardLabel(getBoard('nano-old'), 'es')).toBe('Arduino NANO (bootloader viejo)');
    expect(boardLabel(getBoard('nano-old'), 'en')).toBe('Arduino NANO (old bootloader)');
  });
});
