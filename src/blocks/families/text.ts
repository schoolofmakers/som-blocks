import 'blockly/blocks';
import { Order } from '../arduino-generator';
import {
  cppString,
  isArrayType,
  itemInputs,
  listVariableSize,
  stringInput,
  variableRef,
  valueType,
} from '../cpp-types';
import type { BlockFamily, BlockGenerator } from '../types';

// `text` family: text literals and Arduino `String` operations — Blockly's core text blocks
// with Arduino C++ generators. Pattern: google/blockly generators/javascript/text.ts (join
// casts every item to a string; indexOf is 1-based with 0 for "not found");
// BlocklyDuino/BlocklyDuino blockly/generators/arduino/text.js uses Arduino's String class the
// same way. Printing and prompts are Serial (B4), not here.

const EMPTY = 'String("")';

/** Length of a text, or of a list (text_length and text_isEmpty also accept lists). */
const lengthOf = (...[block, generator]: Parameters<BlockGenerator>): [string, Order] => {
  const child = block.getInputTargetBlock('VALUE');
  const size = listVariableSize(child);
  if (size !== null) return [String(size), Order.ATOMIC];
  if (isArrayType(valueType(child))) {
    // An inline list: generating it flags it as unsupported (lists.ts); never drop its items.
    generator.valueToCode(block, 'VALUE', Order.NONE);
    return ['0', Order.ATOMIC];
  }
  const text = stringInput(block, generator, 'VALUE', Order.POSTFIX, true) ?? EMPTY;
  return [`${text}.length()`, Order.POSTFIX];
};

export const textFamily: BlockFamily = {
  id: 'text',
  blocks: [],
  externalBlocks: [
    'text',
    'text_join',
    'text_length',
    'text_isEmpty',
    'text_append',
    'text_indexOf',
  ],
  generators: {
    text: (block) => [cppString(String(block.getFieldValue('TEXT') ?? '')), Order.ATOMIC],
    text_join: (block, generator) => {
      // The first piece must be a String object so every `+` concatenates; later pieces only
      // need String(…) when they aren't text.
      const parts: string[] = [];
      for (const name of itemInputs(block)) {
        const part = stringInput(block, generator, name, Order.ADDITIVE, parts.length === 0);
        if (part) parts.push(part);
      }
      if (!parts.length) return [EMPTY, Order.POSTFIX];
      return [parts.join(' + '), parts.length === 1 ? Order.POSTFIX : Order.ADDITIVE];
    },
    text_length: lengthOf,
    text_isEmpty: (block, generator) => {
      const [length] = lengthOf(block, generator);
      return [`${length} == 0`, Order.EQUALITY];
    },
    text_append: (block, generator) => {
      const variable = variableRef(block, generator, block.getFieldValue('VAR') as string);
      const text = stringInput(block, generator, 'TEXT', Order.ASSIGNMENT) ?? '""';
      return `${variable} += ${text};\n`;
    },
    text_indexOf: (block, generator) => {
      const method = block.getFieldValue('END') === 'LAST' ? 'lastIndexOf' : 'indexOf';
      const text = stringInput(block, generator, 'VALUE', Order.POSTFIX, true) ?? EMPTY;
      const find = stringInput(block, generator, 'FIND', Order.NONE) ?? '""';
      // Blockly counts from 1 and answers 0 when not found; String::indexOf gives -1.
      return [`${text}.${method}(${find}) + 1`, Order.ADDITIVE];
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_TEXT_CATEGORY}',
    colour: '%{BKY_TEXTS_HUE}',
    contents: [
      { kind: 'block', type: 'text' },
      { kind: 'block', type: 'text_join' },
      {
        kind: 'block',
        type: 'text_length',
        fullOnly: true,
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'abc' } } } },
      },
      {
        kind: 'block',
        type: 'text_isEmpty',
        fullOnly: true,
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: '' } } } },
      },
      {
        kind: 'block',
        type: 'text_append',
        fullOnly: true,
        inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } },
      },
      {
        kind: 'block',
        type: 'text_indexOf',
        fullOnly: true,
        inputs: { FIND: { shadow: { type: 'text', fields: { TEXT: 'abc' } } } },
      },
    ],
  },
  messages: {
    es: { SOM_TEXT_CATEGORY: 'Texto' },
    en: { SOM_TEXT_CATEGORY: 'Text' },
  },
};
