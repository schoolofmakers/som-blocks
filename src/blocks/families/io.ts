import * as Blockly from 'blockly/core';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import { currentPinProfile, type PinOption } from '../pins';
import type { BlockFamily } from '../types';

// `io` family: digital and analog input/output.
//
// pinMode pattern (corpus: carlosperate/ardublockly blockly/generators/arduino/io.js, Apache-2.0;
// BlocklyDuino/BlocklyDuino blockly/generators/arduino/base.js): every pin block puts
// `pinMode(pin, MODE);` into setup() under one key per pin, `io_pin_<pin>`, so a pin used by
// many blocks gets exactly one pinMode line. Ardublockly keeps the *first* mode and warns via
// its pin reservation; BlocklyDuino keys input and output separately and emits both. We keep
// the *last* mode in generation order (ArduinoGenerator.addSetup replaces in place) and, when
// the program uses the same pin as input and as output, append `// TODO conflict: …` to that
// pinMode line so the teacher sees it in the code view. analogRead needs no pinMode (the core
// configures the ADC on AVR and ESP32), so it takes no part in the pinMode bookkeeping.

const COLOUR = '#4a7bd0';

type PinMode = 'INPUT' | 'OUTPUT';

/** Blocks that drive a pin as an output, by type. */
const OUTPUT_BLOCKS = new Set([
  'som_io_digital_write',
  'som_io_analog_write',
  'som_io_builtin_led',
]);
/** Blocks that read a pin as a digital input, by type. */
const INPUT_BLOCKS = new Set(['som_io_digital_read']);

/** The pin a block configures with pinMode, or null if it configures none. */
function pinModeTarget(block: Blockly.Block): { pin: string; mode: PinMode } | null {
  if (block.type === 'som_io_builtin_led') {
    return { pin: currentPinProfile().builtinLed, mode: 'OUTPUT' };
  }
  if (OUTPUT_BLOCKS.has(block.type))
    return { pin: String(block.getFieldValue('PIN')), mode: 'OUTPUT' };
  if (INPUT_BLOCKS.has(block.type))
    return { pin: String(block.getFieldValue('PIN')), mode: 'INPUT' };
  return null;
}

/** Modes the generated program uses on `pin` (blocks that generate code only). */
function modesUsedOn(workspace: Blockly.Workspace, pin: string): Set<PinMode> {
  const modes = new Set<PinMode>();
  for (const other of workspace.getAllBlocks(false)) {
    if (!other.isEnabled() || other.getInheritedDisabled() || other.isInsertionMarker()) continue;
    const target = pinModeTarget(other);
    if (target?.pin === pin) modes.add(target.mode);
  }
  return modes;
}

/** Put `pinMode(pin, mode)` into setup(), keyed by pin; flag input/output conflicts. */
function configurePin(block: Blockly.Block, generator: ArduinoGenerator): string {
  const target = pinModeTarget(block);
  if (!target) throw new Error(`Block "${block.type}" configures no pin`);
  const { pin, mode } = target;
  const modes = modesUsedOn(block.workspace, pin);
  const conflict =
    modes.has('INPUT') && modes.has('OUTPUT')
      ? ` // TODO conflict: pin ${pin} is used as input and output; the last block wins`
      : '';
  generator.addSetup(`io_pin_${pin}`, `pinMode(${pin}, ${mode});${conflict}`);
  return pin;
}

/** Dropdown options read from the active pin profile each time the menu is built. */
const pinOptions =
  (pick: (profile: ReturnType<typeof currentPinProfile>) => readonly PinOption[]) => () =>
    pick(currentPinProfile()).map(([label, value]): [string, string] => [label, value]);

/** analogRead tooltip with the active board's maximum (1023 on AVR, 4095 on ESP32). */
function analogReadTooltip(): string {
  const template = Blockly.Msg['SOM_IO_ANALOG_READ_TOOLTIP'] ?? '';
  return template.replace('%1', String(currentPinProfile().analogMax));
}

export const ioFamily: BlockFamily = {
  id: 'io',
  blocks: [
    {
      type: 'som_io_digital_write',
      message0: '%{BKY_SOM_IO_DIGITAL_WRITE}',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: pinOptions((p) => p.digital) },
        {
          type: 'field_dropdown',
          name: 'STATE',
          options: [
            ['%{BKY_SOM_IO_HIGH}', 'HIGH'],
            ['%{BKY_SOM_IO_LOW}', 'LOW'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_IO_DIGITAL_WRITE_TOOLTIP}',
    },
    {
      type: 'som_io_digital_read',
      message0: '%{BKY_SOM_IO_DIGITAL_READ}',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: pinOptions((p) => p.digital) }],
      output: 'Boolean',
      colour: COLOUR,
      tooltip: '%{BKY_SOM_IO_DIGITAL_READ_TOOLTIP}',
    },
    {
      type: 'som_io_analog_read',
      message0: '%{BKY_SOM_IO_ANALOG_READ}',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: pinOptions((p) => p.analog) }],
      output: 'Number',
      colour: COLOUR,
      // A function so the range follows the active board (Blockly passes non-strings through).
      tooltip: analogReadTooltip,
    },
    {
      type: 'som_io_analog_write',
      message0: '%{BKY_SOM_IO_ANALOG_WRITE}',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: pinOptions((p) => p.pwm) },
        { type: 'input_value', name: 'VALUE', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_IO_ANALOG_WRITE_TOOLTIP}',
    },
    {
      type: 'som_io_builtin_led',
      message0: '%{BKY_SOM_IO_BUILTIN_LED}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'STATE',
          options: [
            ['%{BKY_SOM_IO_ON}', 'ON'],
            ['%{BKY_SOM_IO_OFF}', 'OFF'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_IO_BUILTIN_LED_TOOLTIP}',
    },
  ],
  generators: {
    som_io_digital_write: (block, generator) => {
      const pin = configurePin(block, generator);
      return `digitalWrite(${pin}, ${block.getFieldValue('STATE') === 'LOW' ? 'LOW' : 'HIGH'});\n`;
    },
    som_io_digital_read: (block, generator) => {
      const pin = configurePin(block, generator);
      return [`digitalRead(${pin})`, Order.POSTFIX];
    },
    som_io_analog_read: (block) => [
      `analogRead(${String(block.getFieldValue('PIN'))})`,
      Order.POSTFIX,
    ],
    som_io_analog_write: (block, generator) => {
      const pin = configurePin(block, generator);
      const value = generator.valueToCode(block, 'VALUE', Order.COMMA) || '0';
      return `analogWrite(${pin}, ${value});\n`;
    },
    som_io_builtin_led: (block, generator) => {
      const pin = configurePin(block, generator);
      const on = block.getFieldValue('STATE') !== 'OFF';
      // Active-low LEDs (C3 SuperMini) light on LOW.
      const level = on !== currentPinProfile().builtinLedActiveLow ? 'HIGH' : 'LOW';
      return `digitalWrite(${pin}, ${level});\n`;
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_IO_CATEGORY}',
    colour: COLOUR,
    contents: [
      { kind: 'block', type: 'som_io_builtin_led' },
      { kind: 'block', type: 'som_io_digital_write' },
      { kind: 'block', type: 'som_io_digital_read' },
      { kind: 'block', type: 'som_io_analog_read' },
      { kind: 'block', type: 'som_io_analog_write' },
    ],
  },
  messages: {
    es: {
      SOM_IO_CATEGORY: 'Entrada/Salida',
      SOM_IO_DIGITAL_WRITE: 'poner pin %1 en %2',
      SOM_IO_DIGITAL_WRITE_TOOLTIP:
        'Enciende (HIGH) o apaga (LOW) un pin. Úsalo para un LED o un zumbador.',
      SOM_IO_HIGH: 'encendido',
      SOM_IO_LOW: 'apagado',
      SOM_IO_DIGITAL_READ: 'pin %1 está encendido',
      SOM_IO_DIGITAL_READ_TOOLTIP:
        'Verdadero si el pin recibe corriente (HIGH). Úsalo para leer un botón.',
      SOM_IO_ANALOG_READ: 'leer pin analógico %1',
      SOM_IO_ANALOG_READ_TOOLTIP:
        'Lee un sensor y entrega un número entre 0 y %1 (el máximo depende de tu placa).',
      SOM_IO_ANALOG_WRITE: 'poner pin PWM %1 en %2',
      SOM_IO_ANALOG_WRITE_TOOLTIP:
        'Da un valor de 0 (apagado) a 255 (máximo). Sirve para el brillo de un LED o la velocidad de un motor.',
      SOM_IO_BUILTIN_LED: 'LED de la placa %1',
      SOM_IO_BUILTIN_LED_TOOLTIP: 'Enciende o apaga la luz que viene en tu placa.',
      SOM_IO_ON: 'encendido',
      SOM_IO_OFF: 'apagado',
    },
    en: {
      SOM_IO_CATEGORY: 'Input/Output',
      SOM_IO_DIGITAL_WRITE: 'set pin %1 to %2',
      SOM_IO_DIGITAL_WRITE_TOOLTIP:
        'Turns a pin on (HIGH) or off (LOW). Use it for an LED or a buzzer.',
      SOM_IO_HIGH: 'on',
      SOM_IO_LOW: 'off',
      SOM_IO_DIGITAL_READ: 'pin %1 is on',
      SOM_IO_DIGITAL_READ_TOOLTIP: 'True when the pin gets power (HIGH). Use it to read a button.',
      SOM_IO_ANALOG_READ: 'read analog pin %1',
      SOM_IO_ANALOG_READ_TOOLTIP:
        'Reads a sensor and gives a number from 0 to %1 (the maximum depends on your board).',
      SOM_IO_ANALOG_WRITE: 'set PWM pin %1 to %2',
      SOM_IO_ANALOG_WRITE_TOOLTIP:
        'Gives a value from 0 (off) to 255 (full). Use it for LED brightness or motor speed.',
      SOM_IO_BUILTIN_LED: 'board LED %1',
      SOM_IO_BUILTIN_LED_TOOLTIP: 'Turns the light on your board on or off.',
      SOM_IO_ON: 'on',
      SOM_IO_OFF: 'off',
    },
  },
};
