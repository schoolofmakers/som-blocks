import 'blockly/blocks';
import * as Blockly from 'blockly/core';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import {
  compileError,
  isArrayType,
  listVariableSize,
  numberInput,
  stringInput,
  typedInput,
  valueType,
  type ArrayType,
} from '../cpp-types';
import type { BlockFamily, BlockGenerator } from '../types';

// `lists` family (full toolbox only): a deliberately small subset of Blockly's list blocks
// on fixed-size C arrays. A variable set to `create list with` becomes `double name[N];` in
// the definitions (element type by the heuristic in cpp-types.ts, including the values of
// `set item`) and the set fills it element by element.
//
// Supported: create list with (assigned to a variable), length of, get / set item #, # from
// end, first, last, random — on a list variable. Unsupported, with an `#error` that
// arduino-cli reports verbatim: remove / insert, any list block on something that isn't a list
// variable (an inline list too), an empty list, and giving one variable lists of different
// lengths (variables.ts). Not checked: indexes past the end (C arrays don't grow), and
// lists of lists. Lists can't be parameters or return values. controls_forEach is not offered.
//
// Pattern: carlosperate/ardublockly blockly/generators/arduino/lists.js leaves every list
// block unimplemented (noGeneratorCodeInline); we cover the array-shaped subset instead.

/** Make the sketch fail to compile with a message the student can read in the compile log. */
function unsupported(generator: ArduinoGenerator, block: Blockly.Block, what: string): void {
  const message = (Blockly.Msg['SOM_LISTS_UNSUPPORTED'] ?? '%1').replace('%1', what);
  compileError(generator, block.id, message);
}

/** The list variable plugged into `input`, or `null` (after flagging it) for anything else. */
function listVariable(
  block: Blockly.Block,
  generator: ArduinoGenerator,
  input: string,
): { name: string; type: ArrayType } | null {
  const list = block.getInputTargetBlock(input);
  const type = valueType(list);
  if (list?.type !== 'variables_get' || !isArrayType(type) || type.size === 0) {
    unsupported(generator, block, Blockly.Msg['SOM_LISTS_NOT_A_VARIABLE'] ?? '');
    return null;
  }
  return { name: generator.valueToCode(block, input, Order.POSTFIX), type };
}

/** C index expression (0-based) for Blockly's WHERE / AT, or `null` when unsupported. */
function index(block: Blockly.Block, generator: ArduinoGenerator, size: number): string | null {
  switch (block.getFieldValue('WHERE')) {
    case 'FIRST':
      return '0';
    case 'LAST':
      return String(size - 1);
    case 'RANDOM':
      return `random(${size})`;
    case 'FROM_START': {
      const at = block.getInputTargetBlock('AT')
        ? numberInput(block, generator, 'AT', Order.ADDITIVE)
        : '1';
      return /^\d+$/.test(at) ? String(Number(at) - 1) : `(int)(${at}) - 1`;
    }
    case 'FROM_END': {
      const at = block.getInputTargetBlock('AT')
        ? numberInput(block, generator, 'AT', Order.ADDITIVE)
        : '1';
      return /^\d+$/.test(at) ? String(size - Number(at)) : `${size} - (int)(${at})`;
    }
    default:
      return null;
  }
}

const getIndex: BlockGenerator = (block, generator) => {
  if (block.getFieldValue('MODE') !== 'GET') {
    unsupported(generator, block, Blockly.Msg['SOM_LISTS_NO_REMOVE'] ?? '');
    return block.outputConnection ? ['0', Order.ATOMIC] : '';
  }
  const list = listVariable(block, generator, 'VALUE');
  const at = list && index(block, generator, list.type.size);
  if (!list || at === null) return ['0', Order.ATOMIC];
  return [`${list.name}[${at}]`, Order.POSTFIX];
};

export const listsFamily: BlockFamily = {
  id: 'lists',
  blocks: [],
  externalBlocks: ['lists_create_with', 'lists_length', 'lists_getIndex', 'lists_setIndex'],
  generators: {
    lists_create_with: (block, generator) => {
      // `set variable` and `length of` read this block's items themselves and never call
      // this generator, so reaching it means the list is used where C has no array value. A
      // stray block left loose on the workspace stays harmless.
      if (block.getParent()) {
        unsupported(generator, block, Blockly.Msg['SOM_LISTS_NOT_A_VARIABLE'] ?? '');
      }
      return ['0', Order.ATOMIC];
    },
    lists_length: (block, generator) => {
      const size = listVariableSize(block.getInputTargetBlock('VALUE'));
      if (size !== null) return [String(size), Order.ATOMIC];
      if (isArrayType(valueType(block.getInputTargetBlock('VALUE')))) {
        // An inline list: generating it flags it (its items would otherwise never run).
        generator.valueToCode(block, 'VALUE', Order.NONE);
        return ['0', Order.ATOMIC];
      }
      // The block also takes text.
      const text = stringInput(block, generator, 'VALUE', Order.POSTFIX, true);
      return text ? [`${text}.length()`, Order.POSTFIX] : ['0', Order.ATOMIC];
    },
    lists_getIndex: getIndex,
    lists_setIndex: (block, generator) => {
      if (block.getFieldValue('MODE') !== 'SET') {
        unsupported(generator, block, Blockly.Msg['SOM_LISTS_NO_INSERT'] ?? '');
        return '';
      }
      const list = listVariable(block, generator, 'LIST');
      const at = list && index(block, generator, list.type.size);
      if (!list || at === null) return '';
      const value = typedInput(block, generator, 'TO', list.type.element, Order.ASSIGNMENT);
      return `${list.name}[${at}] = ${value};\n`;
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_LISTS_CATEGORY}',
    colour: '%{BKY_LISTS_HUE}',
    fullOnly: true,
    contents: [
      { kind: 'block', type: 'lists_create_with' },
      { kind: 'block', type: 'lists_length' },
      { kind: 'block', type: 'lists_getIndex' },
      { kind: 'block', type: 'lists_setIndex' },
    ],
  },
  messages: {
    es: {
      SOM_LISTS_CATEGORY: 'Listas',
      SOM_LISTS_UNSUPPORTED: 'Bloque de lista no disponible en Arduino: %1',
      SOM_LISTS_NOT_A_VARIABLE:
        'usa una variable a la que le diste una lista con "crear lista con" (no vacía).',
      SOM_LISTS_NO_REMOVE: 'solo se puede obtener un elemento, no quitarlo.',
      SOM_LISTS_NO_INSERT: 'solo se puede cambiar un elemento, no insertarlo.',
    },
    en: {
      SOM_LISTS_CATEGORY: 'Lists',
      SOM_LISTS_UNSUPPORTED: 'List block not available on Arduino: %1',
      SOM_LISTS_NOT_A_VARIABLE: 'use a variable you set to a (non-empty) "create list with" list.',
      SOM_LISTS_NO_REMOVE: 'you can get an item, but not remove it.',
      SOM_LISTS_NO_INSERT: 'you can set an item, but not insert one.',
    },
  },
};
