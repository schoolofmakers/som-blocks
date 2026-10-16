import * as Blockly from 'blockly/core';
import { Order } from '../arduino-generator';
import type { BlockFamily } from '../types';

// `time` family: waits, the millisecond clock and a non-blocking "every N ms" block.
//
// delay / millis follow carlosperate/ardublockly blockly/generators/arduino/time.js
// (Apache-2.0): plain `delay(x);` and `millis()`, with `0` for an empty input.
//
// `som_time_every` is the classic Arduino "blink without delay" pattern (the same
// `millis() - start >= timeout` check espressif/arduino-esp32 uses in cores/esp32/Stream.cpp):
//   definitions: static unsigned long som_every = 0;   // one timer per block
//   loop:        if (millis() - som_every >= N) { som_every = millis(); …do… }
// The subtraction on unsigned long stays correct when millis() wraps after ~49 days. The
// timer restarts from "now" when it fires, so a slow loop delays the next run instead of
// firing a burst to catch up. Timer names come from the generator's name database, so two
// `every` blocks get `som_every` and `som_every2` and never clash with student variables.

const COLOUR = '#c27c0e';

export const timeFamily: BlockFamily = {
  id: 'time',
  blocks: [
    {
      type: 'som_time_delay_ms',
      message0: '%{BKY_SOM_TIME_DELAY_MS}',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_TIME_DELAY_MS_TOOLTIP}',
    },
    {
      type: 'som_time_delay_s',
      message0: '%{BKY_SOM_TIME_DELAY_S}',
      args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_TIME_DELAY_S_TOOLTIP}',
    },
    {
      type: 'som_time_millis',
      message0: '%{BKY_SOM_TIME_MILLIS}',
      output: 'Number',
      colour: COLOUR,
      tooltip: '%{BKY_SOM_TIME_MILLIS_TOOLTIP}',
    },
    {
      type: 'som_time_every',
      message0: '%{BKY_SOM_TIME_EVERY}',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      message1: '%{BKY_SOM_TIME_EVERY_DO}',
      args1: [{ type: 'input_statement', name: 'DO' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_TIME_EVERY_TOOLTIP}',
    },
  ],
  generators: {
    som_time_delay_ms: (block, generator) => {
      const ms = generator.valueToCode(block, 'MS', Order.COMMA) || '0';
      return `delay(${ms});\n`;
    },
    som_time_delay_s: (block, generator) => {
      const seconds = generator.valueToCode(block, 'SECONDS', Order.MULTIPLICATIVE) || '0';
      // 1000.0, not 1000: an int input (analogRead, a counter) times 1000 overflows AVR's
      // 16-bit int above 32 s before the cast. Floating point also keeps 0.5 s exact.
      return `delay((unsigned long)(${seconds} * 1000.0));\n`;
    },
    som_time_millis: () => ['millis()', Order.POSTFIX],
    som_time_every: (block, generator) => {
      if (!generator.nameDB_) throw new Error('ArduinoGenerator used before init()');
      const timer = generator.nameDB_.getDistinctName('som_every', Blockly.Names.NameType.VARIABLE);
      generator.addDefinition(`som_time_every_${timer}`, `static unsigned long ${timer} = 0;`);
      const ms = generator.valueToCode(block, 'MS', Order.RELATIONAL) || '0';
      const body = generator.statementToCode(block, 'DO');
      return (
        `if (millis() - ${timer} >= ${ms}) {\n` +
        `${generator.INDENT}${timer} = millis();\n` +
        body +
        '}\n'
      );
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_TIME_CATEGORY}',
    colour: COLOUR,
    contents: [
      { kind: 'block', type: 'som_time_delay_ms' },
      { kind: 'block', type: 'som_time_delay_s' },
      { kind: 'block', type: 'som_time_every' },
      { kind: 'block', type: 'som_time_millis' },
    ],
  },
  messages: {
    es: {
      SOM_TIME_CATEGORY: 'Tiempo',
      SOM_TIME_DELAY_MS: 'esperar %1 milisegundos',
      SOM_TIME_DELAY_MS_TOOLTIP: 'Pausa el programa. 1000 milisegundos son 1 segundo.',
      SOM_TIME_DELAY_S: 'esperar %1 segundos',
      SOM_TIME_DELAY_S_TOOLTIP: 'Pausa el programa. Puedes usar decimales, como 0.5.',
      SOM_TIME_MILLIS: 'milisegundos desde que partió',
      SOM_TIME_MILLIS_TOOLTIP: 'Cuántos milisegundos han pasado desde que se encendió la placa.',
      SOM_TIME_EVERY: 'cada %1 milisegundos',
      SOM_TIME_EVERY_DO: 'hacer %1',
      SOM_TIME_EVERY_TOOLTIP:
        'Repite estos bloques cada cierto tiempo sin pausar el resto del programa.',
    },
    en: {
      SOM_TIME_CATEGORY: 'Time',
      SOM_TIME_DELAY_MS: 'wait %1 milliseconds',
      SOM_TIME_DELAY_MS_TOOLTIP: 'Pauses the program. 1000 milliseconds are 1 second.',
      SOM_TIME_DELAY_S: 'wait %1 seconds',
      SOM_TIME_DELAY_S_TOOLTIP: 'Pauses the program. You can use decimals, like 0.5.',
      SOM_TIME_MILLIS: 'milliseconds since start',
      SOM_TIME_MILLIS_TOOLTIP: 'How many milliseconds have passed since the board turned on.',
      SOM_TIME_EVERY: 'every %1 milliseconds',
      SOM_TIME_EVERY_DO: 'do %1',
      SOM_TIME_EVERY_TOOLTIP:
        'Repeats these blocks every so often without pausing the rest of the program.',
    },
  },
};
