import 'blockly/blocks';
import * as Blockly from 'blockly/core';
import { Order } from '../arduino-generator';
import { compileError, variableRef, variableScope, variableType } from '../cpp-types';
import type { BlockFamily } from '../types';

// `control` family: repeat N times, while / until, count with, break / continue — Blockly's
// core loop blocks with Arduino C++ generators. Pattern: google/blockly
// generators/javascript/loops.ts (helper counters from nameDB_.getDistinctName, runtime
// direction for a `for` with computed bounds); BlocklyDuino/BlocklyDuino
// blockly/generators/arduino/control.js for the Arduino shape. `controls_forEach` is left out:
// lists are fixed-size C arrays (see lists.ts).

const NUMBER_LITERAL = /^-?\d+(\.\d+)?$/;

export const controlFamily: BlockFamily = {
  id: 'control',
  blocks: [],
  externalBlocks: [
    'controls_repeat_ext',
    'controls_whileUntil',
    'controls_for',
    'controls_flow_statements',
  ],
  generators: {
    controls_repeat_ext: (block, generator) => {
      // Name the counter before generating the body, so nesting reads outer → inner.
      const count = generator.nameDB_!.getDistinctName('count', Blockly.Names.NameType.VARIABLE);
      const times = generator.valueToCode(block, 'TIMES', Order.ASSIGNMENT) || '0';
      const branch = generator.statementToCode(block, 'DO');
      // `long`: an AVR `int` stops at 32767. A computed count is read once, before the loop,
      // so changing it (or a function call in it) inside the loop doesn't change the repeats.
      if (NUMBER_LITERAL.test(times)) {
        return `for (long ${count} = 0; ${count} < ${times}; ${count}++) {\n${branch}}\n`;
      }
      const limit = generator.nameDB_!.getDistinctName(
        `${count}_times`,
        Blockly.Names.NameType.VARIABLE,
      );
      return (
        `double ${limit} = ${times};\n` +
        `for (long ${count} = 0; ${count} < ${limit}; ${count}++) {\n${branch}}\n`
      );
    },
    controls_whileUntil: (block, generator) => {
      const until = block.getFieldValue('MODE') === 'UNTIL';
      let condition = generator.valueToCode(block, 'BOOL', until ? Order.UNARY_PREFIX : Order.NONE);
      condition = condition || 'false';
      if (until) condition = `!${condition}`;
      return `while (${condition}) {\n${generator.statementToCode(block, 'DO')}}\n`;
    },
    controls_for: (block, generator) => {
      const varId = block.getFieldValue('VAR') as string;
      const variable = variableRef(block, generator, varId);
      // Text (or a list) elsewhere makes the variable a String / array, which can't count.
      if (variableType(block.workspace, varId, variableScope(block, varId)) !== 'double') {
        compileError(generator, block.id, Blockly.Msg['SOM_CONTROL_FOR_NOT_NUMBER'] ?? '');
        return '';
      }
      const from = generator.valueToCode(block, 'FROM', Order.ASSIGNMENT) || '0';
      const to = generator.valueToCode(block, 'TO', Order.ASSIGNMENT) || '0';
      const by = generator.valueToCode(block, 'BY', Order.NONE) || '1';
      const branch = generator.statementToCode(block, 'DO');

      if (NUMBER_LITERAL.test(from) && NUMBER_LITERAL.test(to) && NUMBER_LITERAL.test(by)) {
        // Known bounds: pick the direction now, like Blockly (a negative step counts the
        // same way as a positive one; the bounds decide up or down).
        const up = Number(from) <= Number(to);
        const step = Math.abs(Number(by));
        const update =
          step === 1 ? `${variable}${up ? '++' : '--'}` : `${variable} ${up ? '+=' : '-='} ${step}`;
        return `for (${variable} = ${from}; ${variable} ${up ? '<=' : '>='} ${to}; ${update}) {\n${branch}}\n`;
      }

      // Computed bounds: evaluate them once, then choose the direction at run time.
      const distinct = (suffix: string) =>
        generator.nameDB_!.getDistinctName(
          `${variable}_${suffix}`,
          Blockly.Names.NameType.VARIABLE,
        );
      const start = distinct('start');
      const end = distinct('end');
      const inc = distinct('inc');
      return (
        `double ${start} = ${from};\n` +
        `double ${end} = ${to};\n` +
        `double ${inc} = fabs(${by});\n` +
        `if (${start} > ${end}) ${inc} = -${inc};\n` +
        `for (${variable} = ${start}; ${inc} >= 0 ? ${variable} <= ${end} : ${variable} >= ${end}; ${variable} += ${inc}) {\n` +
        `${branch}}\n`
      );
    },
    controls_flow_statements: (block) =>
      block.getFieldValue('FLOW') === 'CONTINUE' ? 'continue;\n' : 'break;\n',
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_CONTROL_CATEGORY}',
    colour: '%{BKY_LOOPS_HUE}',
    contents: [
      {
        kind: 'block',
        type: 'controls_repeat_ext',
        inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } },
      },
      { kind: 'block', type: 'controls_whileUntil' },
      {
        kind: 'block',
        type: 'controls_for',
        inputs: {
          FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
          TO: { shadow: { type: 'math_number', fields: { NUM: 10 } } },
          BY: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        },
      },
      { kind: 'block', type: 'controls_flow_statements', fullOnly: true },
    ],
  },
  messages: {
    es: {
      SOM_CONTROL_CATEGORY: 'Control',
      SOM_CONTROL_FOR_NOT_NUMBER:
        '"contar con" necesita una variable de números, pero en otra parte le diste texto o una lista.',
    },
    en: {
      SOM_CONTROL_CATEGORY: 'Control',
      SOM_CONTROL_FOR_NOT_NUMBER:
        '"count with" needs a number variable, but somewhere else it gets text or a list.',
    },
  },
};
