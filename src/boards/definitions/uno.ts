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

// Source: _config/boards.md, `uno` row (verified 2026-10-16, compile).
export const uno: BoardDefinition = {
  id: 'uno',
  name: 'Arduino UNO',
  fqbn: 'arduino:avr:uno',
  options: {},
  chip: 'avr',
  upload: { tool: 'avrgirl', avrgirlBoard: 'uno', baud: 115200 },
  usbFilters: [
    { usbVendorId: 0x2341, usbProductId: 0x0043 },
    { usbVendorId: 0x2341, usbProductId: 0x0001 },
    { usbVendorId: 0x2341, usbProductId: 0x0243 },
    { usbVendorId: 0x2a03, usbProductId: 0x0043 },
    { usbVendorId: 0x1a86, usbProductId: 0x7523 },
  ],
  pins: {
    digital: ATMEGA328_DIGITAL,
    analog: ATMEGA328_ANALOG,
    pwm: ATMEGA328_PWM,
    builtinLed: ATMEGA328_BUILTIN_LED,
    builtinLedActiveLow: false,
    analogMax: ATMEGA328_ANALOG_MAX,
    i2c: ATMEGA328_I2C,
    spi: ATMEGA328_SPI,
    uart: ATMEGA328_UART,
  },
};
