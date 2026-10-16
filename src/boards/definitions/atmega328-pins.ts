import type { PinOption } from '../../blocks/pins';

// ATmega328P pins shared by the UNO and the NANO (same chip, same Arduino core variant).
// Labels follow the board silkscreen; values are what the generator emits.

/** D0–D13. D0/D1 are the USB serial pins; using them breaks upload and Serial. */
export const ATMEGA328_DIGITAL: readonly PinOption[] = [
  ['D0', '0'],
  ['D1', '1'],
  ['D2', '2'],
  ['D3', '3'],
  ['D4', '4'],
  ['D5', '5'],
  ['D6', '6'],
  ['D7', '7'],
  ['D8', '8'],
  ['D9', '9'],
  ['D10', '10'],
  ['D11', '11'],
  ['D12', '12'],
  ['D13', '13'],
];

/** Hardware PWM (`analogWrite`) pins, marked `~` on the silkscreen. */
export const ATMEGA328_PWM: readonly PinOption[] = [
  ['D3', '3'],
  ['D5', '5'],
  ['D6', '6'],
  ['D9', '9'],
  ['D10', '10'],
  ['D11', '11'],
];

/** A0–A5, on both boards. */
export const ATMEGA328_ANALOG: readonly PinOption[] = [
  ['A0', 'A0'],
  ['A1', 'A1'],
  ['A2', 'A2'],
  ['A3', 'A3'],
  ['A4', 'A4'],
  ['A5', 'A5'],
];

export const ATMEGA328_BUILTIN_LED = '13';
/** 10-bit ADC. */
export const ATMEGA328_ANALOG_MAX = 1023;
