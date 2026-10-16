import type { BoardDefinition } from '../types';
import {
  ATMEGA328_ANALOG,
  ATMEGA328_ANALOG_MAX,
  ATMEGA328_BUILTIN_LED,
  ATMEGA328_DIGITAL,
  ATMEGA328_I2C,
  ATMEGA328_PWM,
  ATMEGA328_SPI,
  ATMEGA328_UART,
} from './atmega328-pins';

// Source: _config/boards.md, `nano-old` row (verified 2026-10-16 on hardware).
export const nanoOld: BoardDefinition = {
  id: 'nano-old',
  name: 'Arduino NANO',
  variantKey: 'UI_BOARD_VARIANT_OLD_BOOTLOADER',
  fqbn: 'arduino:avr:nano',
  options: { cpu: 'atmega328old' },
  chip: 'avr',
  upload: { tool: 'avrgirl', avrgirlBoard: 'nano', baud: 57600 },
  usbFilters: [
    { usbVendorId: 0x1a86, usbProductId: 0x7523 },
    { usbVendorId: 0x0403, usbProductId: 0x6001 },
  ],
  pins: {
    digital: ATMEGA328_DIGITAL,
    // A6/A7 are analog-input only on the NANO: no digitalRead/digitalWrite.
    analog: [...ATMEGA328_ANALOG, ['A6', 'A6'], ['A7', 'A7']],
    pwm: ATMEGA328_PWM,
    builtinLed: ATMEGA328_BUILTIN_LED,
    builtinLedActiveLow: false,
    analogMax: ATMEGA328_ANALOG_MAX,
    i2c: ATMEGA328_I2C,
    spi: ATMEGA328_SPI,
    uart: ATMEGA328_UART,
  },
  notes: 'Clones with the old (57600 baud) bootloader, common with CH340 USB chips.',
};
