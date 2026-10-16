import type * as Blockly from 'blockly/core';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import type { BlockFamily } from '../types';

// `serial` family: the USB serial port (Serial) for printing, reading and plotting.
//
// Pattern: carlosperate/ardublockly blockly/generators/arduino/serial.js (Apache-2.0) puts
// `Serial.begin(speed);` into setup() under one key and prints with `Serial.print[ln](x);`.
// Difference: students forget the begin block, and then nothing shows up in the monitor. So
// every serial block calls `ensureBegin`: when the program has no enabled begin block, it adds
// `Serial.begin(DEFAULT_BAUD);` under the same setup key. With a begin block, the begin block
// owns that key (several begin blocks: the last one generated wins).

const COLOUR = '#2e9e6b';
const SETUP_KEY = 'serial_begin';
export const DEFAULT_BAUD = '115200';
const BAUDS = ['9600', '19200', '38400', '57600', '115200'];

function hasBeginBlock(workspace: Blockly.Workspace): boolean {
  return workspace
    .getBlocksByType('som_serial_begin', false)
    .some((b) => b.isEnabled() && !b.getInheritedDisabled() && !b.isInsertionMarker());
}

function ensureBegin(block: Blockly.Block, generator: ArduinoGenerator): void {
  if (!hasBeginBlock(block.workspace)) {
    generator.addSetup(SETUP_KEY, `Serial.begin(${DEFAULT_BAUD});`);
  }
}

/** Serial Plotter labels end at `:` and series are split by `,` or spaces. */
function plotLabel(raw: unknown): string {
  return (
    String(raw ?? '')
      .trim()
      .replace(/[\s:,"\\]+/g, '_') || 'value'
  );
}

export const serialFamily: BlockFamily = {
  id: 'serial',
  blocks: [
    {
      type: 'som_serial_begin',
      message0: '%{BKY_SOM_SERIAL_BEGIN}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'BAUD',
          options: BAUDS.map((baud) => [baud, baud]),
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_SERIAL_BEGIN_TOOLTIP}',
    },
    {
      type: 'som_serial_print',
      message0: '%{BKY_SOM_SERIAL_PRINT}',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_SERIAL_PRINT_TOOLTIP}',
    },
    {
      type: 'som_serial_println',
      message0: '%{BKY_SOM_SERIAL_PRINTLN}',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_SERIAL_PRINTLN_TOOLTIP}',
    },
    {
      type: 'som_serial_available',
      message0: '%{BKY_SOM_SERIAL_AVAILABLE}',
      output: 'Boolean',
      colour: COLOUR,
      tooltip: '%{BKY_SOM_SERIAL_AVAILABLE_TOOLTIP}',
    },
    {
      type: 'som_serial_read_line',
      message0: '%{BKY_SOM_SERIAL_READ_LINE}',
      output: 'String',
      colour: COLOUR,
      tooltip: '%{BKY_SOM_SERIAL_READ_LINE_TOOLTIP}',
    },
    {
      type: 'som_serial_plot',
      message0: '%{BKY_SOM_SERIAL_PLOT}',
      args0: [
        { type: 'field_input', name: 'LABEL', text: '%{BKY_SOM_SERIAL_PLOT_LABEL}' },
        { type: 'input_value', name: 'VALUE', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_SERIAL_PLOT_TOOLTIP}',
    },
  ],
  generators: {
    som_serial_begin: (block, generator) => {
      const baud = String(block.getFieldValue('BAUD'));
      generator.addSetup(SETUP_KEY, `Serial.begin(${BAUDS.includes(baud) ? baud : DEFAULT_BAUD});`);
      return '';
    },
    som_serial_print: (block, generator) => {
      ensureBegin(block, generator);
      const value = generator.valueToCode(block, 'VALUE', Order.COMMA) || '""';
      return `Serial.print(${value});\n`;
    },
    som_serial_println: (block, generator) => {
      ensureBegin(block, generator);
      const value = generator.valueToCode(block, 'VALUE', Order.COMMA) || '""';
      return `Serial.println(${value});\n`;
    },
    som_serial_available: (block, generator) => {
      ensureBegin(block, generator);
      return ['Serial.available() > 0', Order.RELATIONAL];
    },
    som_serial_read_line: (block, generator) => {
      ensureBegin(block, generator);
      return ["Serial.readStringUntil('\\n')", Order.POSTFIX];
    },
    som_serial_plot: (block, generator) => {
      ensureBegin(block, generator);
      const value = generator.valueToCode(block, 'VALUE', Order.COMMA) || '0';
      const label = plotLabel(block.getFieldValue('LABEL'));
      return `Serial.print("${label}:");\nSerial.println(${value});\n`;
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_SERIAL_CATEGORY}',
    colour: COLOUR,
    contents: [
      { kind: 'block', type: 'som_serial_begin', fields: { BAUD: DEFAULT_BAUD } },
      {
        kind: 'block',
        type: 'som_serial_println',
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hola' } } } },
      },
      {
        kind: 'block',
        type: 'som_serial_print',
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hola' } } } },
      },
      {
        kind: 'block',
        type: 'som_serial_plot',
        inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } },
      },
      { kind: 'block', type: 'som_serial_available' },
      { kind: 'block', type: 'som_serial_read_line' },
    ],
  },
  messages: {
    es: {
      SOM_SERIAL_CATEGORY: 'Puerto Serie',
      SOM_SERIAL_BEGIN: 'iniciar puerto serie a %1 baudios',
      SOM_SERIAL_BEGIN_TOOLTIP:
        'Prepara la conexión con el computador. Usa la misma velocidad en el monitor.',
      SOM_SERIAL_PRINT: 'escribir %1',
      SOM_SERIAL_PRINT_TOOLTIP: 'Envía un texto o número al computador, sin saltar de línea.',
      SOM_SERIAL_PRINTLN: 'escribir línea %1',
      SOM_SERIAL_PRINTLN_TOOLTIP: 'Envía un texto o número al computador y salta de línea.',
      SOM_SERIAL_AVAILABLE: 'llegó un mensaje',
      SOM_SERIAL_AVAILABLE_TOOLTIP: 'Verdadero si el computador envió algo que aún no lees.',
      SOM_SERIAL_READ_LINE: 'leer línea',
      SOM_SERIAL_READ_LINE_TOOLTIP: 'Lee el texto que llegó hasta el salto de línea.',
      SOM_SERIAL_PLOT: 'graficar %1 %2',
      SOM_SERIAL_PLOT_LABEL: 'valor',
      SOM_SERIAL_PLOT_TOOLTIP: 'Envía un número con su nombre para verlo en el graficador.',
    },
    en: {
      SOM_SERIAL_CATEGORY: 'Serial Port',
      SOM_SERIAL_BEGIN: 'start serial port at %1 baud',
      SOM_SERIAL_BEGIN_TOOLTIP:
        'Gets the connection to the computer ready. Use the same speed in the monitor.',
      SOM_SERIAL_PRINT: 'print %1',
      SOM_SERIAL_PRINT_TOOLTIP: 'Sends text or a number to the computer, on the same line.',
      SOM_SERIAL_PRINTLN: 'print line %1',
      SOM_SERIAL_PRINTLN_TOOLTIP: 'Sends text or a number to the computer and starts a new line.',
      SOM_SERIAL_AVAILABLE: 'a message arrived',
      SOM_SERIAL_AVAILABLE_TOOLTIP: 'True when the computer sent something you have not read yet.',
      SOM_SERIAL_READ_LINE: 'read line',
      SOM_SERIAL_READ_LINE_TOOLTIP: 'Reads the text that arrived, up to the end of the line.',
      SOM_SERIAL_PLOT: 'plot %1 %2',
      SOM_SERIAL_PLOT_LABEL: 'value',
      SOM_SERIAL_PLOT_TOOLTIP: 'Sends a number with its name so you can see it in the plotter.',
    },
  },
};
