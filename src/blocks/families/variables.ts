import 'blockly/blocks';
import * as Blockly from 'blockly/core';
import { Order } from '../arduino-generator';
import {
  compileError,
  isArrayType,
  itemInputs,
  scalarOf,
  typedInput,
  variableRef,
  variableScope,
  variableType,
} from '../cpp-types';
import type { BlockFamily } from '../types';

// `variables` family: get / set on Blockly's (untyped) variables. Each variable becomes one
// global, declared once in the definitions section with the type the heuristic in
// cpp-types.ts picks (double by default, String for text, bool for true/false, a fixed-size
// array for a list). Names come from the generator's nameDB_, so a variable called `int`,
// `map` or `delay` turns into `int2`, `map2`, `delay2` instead of breaking the sketch.
// Pattern: BlocklyDuino/BlocklyDuino blockly/generators/arduino/variables.js (getter/setter
// shape) + carlosperate/ardublockly blockly/generators/arduino.js (typed global declarations).

export const variablesFamily: BlockFamily = {
  id: 'variables',
  blocks: [],
  externalBlocks: ['variables_get', 'variables_set'],
  generators: {
    variables_get: (block, generator) => [
      variableRef(block, generator, block.getFieldValue('VAR') as string),
      Order.ATOMIC,
    ],
    variables_set: (block, generator) => {
      const varId = block.getFieldValue('VAR') as string;
      const variable = variableRef(block, generator, varId);
      const type = variableType(block.workspace, varId, variableScope(block, varId));
      const value = block.getInputTargetBlock('VALUE');

      // C arrays can't be assigned as a whole: a list literal fills the array element by
      // element. Any other value for a list variable falls through to `name = value;`, which
      // arduino-cli rejects ("invalid array assignment") — unsupported, see lists.ts.
      if (isArrayType(type) && value?.type === 'lists_create_with') {
        const items = itemInputs(value);
        // A fixed-size array can't shrink or grow: every list given to one variable must have
        // the same, non-zero length, or stale items would silently stay behind.
        if (items.length === 0 || items.length !== type.size) {
          compileError(generator, block.id, Blockly.Msg['SOM_VARIABLES_LIST_SIZE'] ?? '');
          return '';
        }
        return items
          .map(
            (name, index) =>
              `${variable}[${index}] = ${typedInput(value, generator, name, type.element, Order.ASSIGNMENT)};\n`,
          )
          .join('');
      }
      return `${variable} = ${typedInput(block, generator, 'VALUE', scalarOf(type), Order.ASSIGNMENT)};\n`;
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_VARIABLES_CATEGORY}',
    colour: '%{BKY_VARIABLES_HUE}',
    custom: 'VARIABLE',
    contents: [],
  },
  messages: {
    es: {
      SOM_VARIABLES_CATEGORY: 'Variables',
      SOM_VARIABLES_LIST_SIZE:
        'Una variable con lista debe recibir siempre listas con el mismo número de elementos (al menos uno).',
    },
    en: {
      SOM_VARIABLES_CATEGORY: 'Variables',
      SOM_VARIABLES_LIST_SIZE:
        'A list variable must always get lists with the same number of items (at least one).',
    },
  },
};
