import 'blockly/blocks';
import { Order } from '../arduino-generator';
import { stringInput, valueType } from '../cpp-types';
import type { BlockFamily } from '../types';

// `logic` family: if / else, comparisons, and / or / not, true / false — Blockly's core blocks
// (blockly/blocks) with Arduino C++ generators. Pattern: google/blockly
// generators/javascript/logic.ts (same block shapes); Arduino output checked against
// BlocklyDuino/BlocklyDuino blockly/generators/arduino/logic.js. Written fresh.

const COMPARE: Record<string, [string, Order]> = {
  EQ: ['==', Order.EQUALITY],
  NEQ: ['!=', Order.EQUALITY],
  LT: ['<', Order.RELATIONAL],
  LTE: ['<=', Order.RELATIONAL],
  GT: ['>', Order.RELATIONAL],
  GTE: ['>=', Order.RELATIONAL],
};

export const logicFamily: BlockFamily = {
  id: 'logic',
  blocks: [],
  externalBlocks: [
    'controls_if',
    'logic_compare',
    'logic_operation',
    'logic_negate',
    'logic_boolean',
    'logic_ternary',
  ],
  generators: {
    controls_if: (block, generator) => {
      let code = '';
      for (let n = 0; block.getInput(`IF${n}`); n++) {
        const condition = generator.valueToCode(block, `IF${n}`, Order.NONE) || 'false';
        const branch = generator.statementToCode(block, `DO${n}`);
        code += `${n > 0 ? ' else ' : ''}if (${condition}) {\n${branch}}`;
      }
      if (block.getInput('ELSE')) {
        code += ` else {\n${generator.statementToCode(block, 'ELSE')}}`;
      }
      return `${code}\n`;
    },
    logic_compare: (block, generator) => {
      const [operator, order] = COMPARE[block.getFieldValue('OP') as string] ?? COMPARE.EQ!;
      // `"a" == "b"` compares pointers in C++; with text on either side, make the left side a
      // String object so the comparison is by content.
      const textual =
        valueType(block.getInputTargetBlock('A')) === 'String' ||
        valueType(block.getInputTargetBlock('B')) === 'String';
      if (textual) {
        const a = stringInput(block, generator, 'A', order, true) ?? 'String("")';
        const b = stringInput(block, generator, 'B', order) ?? '""';
        return [`${a} ${operator} ${b}`, order];
      }
      const a = generator.valueToCode(block, 'A', order) || '0';
      const b = generator.valueToCode(block, 'B', order) || '0';
      return [`${a} ${operator} ${b}`, order];
    },
    logic_operation: (block, generator) => {
      const isAnd = block.getFieldValue('OP') === 'AND';
      const order = isAnd ? Order.LOGICAL_AND : Order.LOGICAL_OR;
      let a = generator.valueToCode(block, 'A', order);
      let b = generator.valueToCode(block, 'B', order);
      if (!a && !b) {
        a = 'false';
        b = 'false';
      } else {
        // One empty side must not change the result: `x && true`, `x || false`.
        const neutral = isAnd ? 'true' : 'false';
        a ||= neutral;
        b ||= neutral;
      }
      return [`${a} ${isAnd ? '&&' : '||'} ${b}`, order];
    },
    logic_negate: (block, generator) => {
      const value = generator.valueToCode(block, 'BOOL', Order.UNARY_PREFIX) || 'true';
      return [`!${value}`, Order.UNARY_PREFIX];
    },
    logic_boolean: (block) => [
      block.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false',
      Order.ATOMIC,
    ],
    logic_ternary: (block, generator) => {
      const condition = generator.valueToCode(block, 'IF', Order.CONDITIONAL) || 'false';
      // Both choices need one C++ type: with text on either side, both become Strings.
      if (valueType(block) === 'String') {
        const then = stringInput(block, generator, 'THEN', Order.CONDITIONAL, true) ?? 'String("")';
        const otherwise =
          stringInput(block, generator, 'ELSE', Order.CONDITIONAL, true) ?? 'String("")';
        return [`${condition} ? ${then} : ${otherwise}`, Order.CONDITIONAL];
      }
      const then = generator.valueToCode(block, 'THEN', Order.CONDITIONAL) || '0';
      const otherwise = generator.valueToCode(block, 'ELSE', Order.CONDITIONAL) || '0';
      return [`${condition} ? ${then} : ${otherwise}`, Order.CONDITIONAL];
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_LOGIC_CATEGORY}',
    colour: '%{BKY_LOGIC_HUE}',
    contents: [
      { kind: 'block', type: 'controls_if' },
      { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
      { kind: 'block', type: 'logic_compare' },
      { kind: 'block', type: 'logic_operation' },
      { kind: 'block', type: 'logic_negate' },
      { kind: 'block', type: 'logic_boolean' },
      { kind: 'block', type: 'logic_ternary', fullOnly: true },
    ],
  },
  messages: {
    es: { SOM_LOGIC_CATEGORY: 'Lógica' },
    en: { SOM_LOGIC_CATEGORY: 'Logic' },
  },
};
