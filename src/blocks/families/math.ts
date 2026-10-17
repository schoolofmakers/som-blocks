import 'blockly/blocks';
import * as Blockly from 'blockly/core';
import { Order } from '../arduino-generator';
import { numberInput, variableRef, variableScope, variableType } from '../cpp-types';
import type { BlockFamily, BlockGenerator } from '../types';

// `math` family: Blockly's core math blocks with Arduino C++ generators, plus our own
// `som_math_map` for Arduino's map() (Blockly has none). Pattern: google/blockly
// generators/javascript/math.ts (operator table, NEG spacing, prime helper);
// BlocklyDuino/BlocklyDuino blockly/generators/arduino/math.js for the Arduino calls. Written
// fresh. Numbers are `double` (cpp-types.ts), so modulo and parity use fmod() and abs uses
// fabs(); Arduino's integer-only map() and random() stay integer, as on the Arduino reference.

const INTEGER_LITERAL = /^-?\d+$/;

const ARITHMETIC: Record<string, [string, Order]> = {
  ADD: [' + ', Order.ADDITIVE],
  MINUS: [' - ', Order.ADDITIVE],
  MULTIPLY: [' * ', Order.MULTIPLICATIVE],
  DIVIDE: [' / ', Order.MULTIPLICATIVE],
};

/** C function per math_single / math_trig operator; trig works in degrees, as in Blockly. */
const SINGLE: Record<string, (x: string) => string> = {
  ROOT: (x) => `sqrt(${x})`,
  ABS: (x) => `fabs(${x})`,
  LN: (x) => `log(${x})`,
  LOG10: (x) => `log10(${x})`,
  EXP: (x) => `exp(${x})`,
  POW10: (x) => `pow(10, ${x})`,
  SIN: (x) => `sin(${x} * DEG_TO_RAD)`,
  COS: (x) => `cos(${x} * DEG_TO_RAD)`,
  TAN: (x) => `tan(${x} * DEG_TO_RAD)`,
  ASIN: (x) => `asin(${x}) * RAD_TO_DEG`,
  ACOS: (x) => `acos(${x}) * RAD_TO_DEG`,
  ATAN: (x) => `atan(${x}) * RAD_TO_DEG`,
};

const single: BlockGenerator = (block, generator) => {
  const op = block.getFieldValue('OP') as string;
  if (op === 'NEG') {
    let x = numberInput(block, generator, 'NUM', Order.UNARY_PREFIX);
    // `- -1`, never `--1` (the decrement operator).
    if (x.startsWith('-')) x = ` ${x}`;
    return [`-${x}`, Order.UNARY_PREFIX];
  }
  const inner = op === 'SIN' || op === 'COS' || op === 'TAN' ? Order.MULTIPLICATIVE : Order.NONE;
  const x = numberInput(block, generator, 'NUM', inner);
  const toCode = SINGLE[op] ?? SINGLE.ROOT!;
  return [toCode(x), op.startsWith('A') && op !== 'ABS' ? Order.MULTIPLICATIVE : Order.POSTFIX];
};

/**
 * Add a helper function to the definitions once per run and return its name, which nameDB_
 * keeps distinct from the student's names. `lines` gets that name.
 */
function provideHelper(
  generator: Parameters<BlockGenerator>[1],
  desired: string,
  lines: (name: string) => string[],
): string {
  const name = generator.nameDB_!.getName(desired, Blockly.Names.NameType.DEVELOPER_VARIABLE);
  generator.addDefinition(`math:${desired}`, lines(name).join('\n'));
  return name;
}

const isPrimeHelper = (name: string) => [
  `bool ${name}(double n) {`,
  '  if (n < 2 || n != floor(n)) return false;',
  '  if (n == 2 || n == 3) return true;',
  '  if (fmod(n, 2) == 0 || fmod(n, 3) == 0) return false;',
  // Square in double: `long * long` overflows near the top of a 32-bit long.
  '  for (long i = 6; (double)(i - 1) * (i - 1) <= n; i += 6) {',
  '    if (fmod(n, i - 1) == 0 || fmod(n, i + 1) == 0) return false;',
  '  }',
  '  return true;',
  '}',
];

/** A number or a variable name: safe to repeat inside an Arduino macro. */
const SIMPLE_ARGUMENT = /^-?[\w.]+$/;

const constrainHelper = (name: string) => [
  `double ${name}(double x, double low, double high) {`,
  '  if (x < low) return low;',
  '  if (x > high) return high;',
  '  return x;',
  '}',
];

/** Blockly's random integer: both bounds included, in either order, each evaluated once. */
const randomIntHelper = (name: string) => [
  `long ${name}(double a, double b) {`,
  '  if (a > b) {',
  '    double t = a;',
  '    a = b;',
  '    b = t;',
  '  }',
  '  return random((long)a, (long)b + 1);',
  '}',
];

export const mathFamily: BlockFamily = {
  id: 'math',
  blocks: [
    {
      type: 'som_math_map',
      message0: '%{BKY_SOM_MATH_MAP}',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'input_value', name: 'FROM_LOW', check: 'Number' },
        { type: 'input_value', name: 'FROM_HIGH', check: 'Number' },
        { type: 'input_value', name: 'TO_LOW', check: 'Number' },
        { type: 'input_value', name: 'TO_HIGH', check: 'Number' },
      ],
      inputsInline: true,
      output: 'Number',
      style: 'math_blocks',
      tooltip: '%{BKY_SOM_MATH_MAP_TOOLTIP}',
    },
  ],
  externalBlocks: [
    'math_number',
    'math_arithmetic',
    'math_single',
    'math_trig',
    'math_number_property',
    'math_round',
    'math_modulo',
    'math_constrain',
    'math_random_int',
    'math_random_float',
    'math_change',
  ],
  generators: {
    math_number: (block) => {
      const value = Number(block.getFieldValue('NUM'));
      if (Number.isNaN(value)) return ['NAN', Order.ATOMIC];
      if (value === Infinity) return ['INFINITY', Order.ATOMIC];
      if (value === -Infinity) return ['-INFINITY', Order.UNARY_PREFIX];
      return [String(value), value < 0 ? Order.UNARY_PREFIX : Order.ATOMIC];
    },
    math_arithmetic: (block, generator) => {
      const op = block.getFieldValue('OP') as string;
      if (op === 'POWER') {
        const a = numberInput(block, generator, 'A', Order.NONE);
        const b = numberInput(block, generator, 'B', Order.NONE);
        return [`pow(${a}, ${b})`, Order.POSTFIX];
      }
      const [operator, order] = ARITHMETIC[op] ?? ARITHMETIC.ADD!;
      let a = numberInput(block, generator, 'A', order);
      let b = numberInput(block, generator, 'B', order);
      if (op === 'DIVIDE') {
        // Blockly divides like a calculator (7 / 2 = 3.5); C++ would truncate two integers.
        b = INTEGER_LITERAL.test(b) ? `${b}.0` : `(double)${b}`;
      } else if (INTEGER_LITERAL.test(a)) {
        // An integer literal is a C++ `int`, and so are some Arduino results (String
        // length…): 300 * 300 overflows AVR's 16-bit int. A double literal makes the whole
        // calculation double, like every number variable.
        a = `${a}.0`;
      } else if (INTEGER_LITERAL.test(b)) {
        b = `${b}.0`;
      }
      return [`${a}${operator}${b}`, order];
    },
    math_single: single,
    math_trig: single,
    math_number_property: (block, generator) => {
      const property = block.getFieldValue('PROPERTY') as string;
      if (property === 'PRIME') {
        const n = numberInput(block, generator, 'NUMBER_TO_CHECK', Order.NONE);
        return [`${provideHelper(generator, 'isPrime', isPrimeHelper)}(${n})`, Order.POSTFIX];
      }
      if (property === 'POSITIVE' || property === 'NEGATIVE') {
        const n = numberInput(block, generator, 'NUMBER_TO_CHECK', Order.RELATIONAL);
        return [`${n} ${property === 'POSITIVE' ? '>' : '<'} 0`, Order.RELATIONAL];
      }
      const n = numberInput(block, generator, 'NUMBER_TO_CHECK', Order.NONE);
      const divisor =
        property === 'DIVISIBLE_BY'
          ? numberInput(block, generator, 'DIVISOR', Order.NONE)
          : property === 'WHOLE'
            ? '1'
            : '2';
      // Odd means a remainder of ±1, so a fraction like 2.5 is neither even nor odd.
      if (property === 'ODD') return [`fabs(fmod(${n}, 2)) == 1`, Order.EQUALITY];
      return [`fmod(${n}, ${divisor}) == 0`, Order.EQUALITY];
    },
    math_round: (block, generator) => {
      const op = block.getFieldValue('OP') as string;
      if (op === 'ROUND') {
        // AVR's round() is a macro that evaluates its argument twice and returns a long;
        // floor(x + 0.5) reads x once and rounds like Blockly (Math.round).
        const x = numberInput(block, generator, 'NUM', Order.ADDITIVE);
        return [`floor(${x} + 0.5)`, Order.POSTFIX];
      }
      const x = numberInput(block, generator, 'NUM', Order.NONE);
      return [`${op === 'ROUNDUP' ? 'ceil' : 'floor'}(${x})`, Order.POSTFIX];
    },
    math_modulo: (block, generator) => {
      const a = numberInput(block, generator, 'DIVIDEND', Order.NONE);
      const b = numberInput(block, generator, 'DIVISOR', Order.NONE);
      return [`fmod(${a}, ${b})`, Order.POSTFIX];
    },
    math_constrain: (block, generator) => {
      const value = numberInput(block, generator, 'VALUE', Order.NONE);
      const low = numberInput(block, generator, 'LOW', Order.NONE);
      const high = numberInput(block, generator, 'HIGH', Order.NONE);
      // Arduino's constrain() is a macro that may evaluate an argument several times: fine
      // for numbers and variables, wrong for a function call or random(). Anything else goes
      // through a helper that reads each value once.
      if ([value, low, high].every((arg) => SIMPLE_ARGUMENT.test(arg))) {
        return [`constrain(${value}, ${low}, ${high})`, Order.POSTFIX];
      }
      const helper = provideHelper(generator, 'constrainValue', constrainHelper);
      return [`${helper}(${value}, ${low}, ${high})`, Order.POSTFIX];
    },
    math_random_int: (block, generator) => {
      const from = numberInput(block, generator, 'FROM', Order.NONE);
      const to = numberInput(block, generator, 'TO', Order.NONE);
      if (INTEGER_LITERAL.test(from) && INTEGER_LITERAL.test(to)) {
        // Known bounds: order them now. Blockly includes the upper bound; Arduino's
        // random(min, max) excludes it.
        const [low, high] = [Number(from), Number(to)].sort((x, y) => x - y);
        return [`random(${low}, ${high! + 1})`, Order.POSTFIX];
      }
      return [
        `${provideHelper(generator, 'randomInt', randomIntHelper)}(${from}, ${to})`,
        Order.POSTFIX,
      ];
    },
    math_random_float: () => ['random(1000000) / 1000000.0', Order.MULTIPLICATIVE],
    math_change: (block, generator) => {
      const varId = block.getFieldValue('VAR') as string;
      const variable = variableRef(block, generator, varId);
      if (variableType(block.workspace, varId, variableScope(block, varId)) === 'String') {
        // Text elsewhere made it a String, where `+=` would append. Add as a number instead.
        const delta = numberInput(block, generator, 'DELTA', Order.ADDITIVE);
        return `${variable} = String(${variable}.toDouble() + ${delta});\n`;
      }
      const delta = numberInput(block, generator, 'DELTA', Order.ASSIGNMENT);
      return `${variable} += ${delta};\n`;
    },
    som_math_map: (block, generator) => {
      const args = ['VALUE', 'FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'].map((name) =>
        numberInput(block, generator, name, Order.NONE),
      );
      return [`map(${args.join(', ')})`, Order.POSTFIX];
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_MATH_CATEGORY}',
    colour: '%{BKY_MATH_HUE}',
    contents: [
      { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
      {
        kind: 'block',
        type: 'math_arithmetic',
        inputs: {
          A: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
          B: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        },
      },
      {
        kind: 'block',
        type: 'math_random_int',
        inputs: {
          FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
          TO: { shadow: { type: 'math_number', fields: { NUM: 6 } } },
        },
      },
      {
        kind: 'block',
        type: 'som_math_map',
        inputs: {
          VALUE: { shadow: { type: 'math_number', fields: { NUM: 512 } } },
          FROM_LOW: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
          FROM_HIGH: { shadow: { type: 'math_number', fields: { NUM: 1023 } } },
          TO_LOW: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
          TO_HIGH: { shadow: { type: 'math_number', fields: { NUM: 255 } } },
        },
      },
      {
        kind: 'block',
        type: 'math_constrain',
        inputs: {
          VALUE: { shadow: { type: 'math_number', fields: { NUM: 50 } } },
          LOW: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
          HIGH: { shadow: { type: 'math_number', fields: { NUM: 100 } } },
        },
      },
      {
        kind: 'block',
        type: 'math_single',
        fullOnly: true,
        inputs: { NUM: { shadow: { type: 'math_number', fields: { NUM: 9 } } } },
      },
      {
        kind: 'block',
        type: 'math_trig',
        fullOnly: true,
        inputs: { NUM: { shadow: { type: 'math_number', fields: { NUM: 45 } } } },
      },
      {
        kind: 'block',
        type: 'math_number_property',
        fullOnly: true,
        inputs: { NUMBER_TO_CHECK: { shadow: { type: 'math_number', fields: { NUM: 0 } } } },
      },
      {
        kind: 'block',
        type: 'math_round',
        fullOnly: true,
        inputs: { NUM: { shadow: { type: 'math_number', fields: { NUM: 3.1 } } } },
      },
      {
        kind: 'block',
        type: 'math_modulo',
        fullOnly: true,
        inputs: {
          DIVIDEND: { shadow: { type: 'math_number', fields: { NUM: 64 } } },
          DIVISOR: { shadow: { type: 'math_number', fields: { NUM: 10 } } },
        },
      },
      { kind: 'block', type: 'math_random_float', fullOnly: true },
    ],
  },
  messages: {
    es: {
      SOM_MATH_CATEGORY: 'Matemáticas',
      SOM_MATH_MAP: 'convertir %1 de %2 – %3 a %4 – %5',
      SOM_MATH_MAP_TOOLTIP:
        'Cambia un número de un rango a otro. Ejemplo: 0–1023 de un sensor a 0–255 para un LED.',
    },
    en: {
      SOM_MATH_CATEGORY: 'Math',
      SOM_MATH_MAP: 'map %1 from %2 – %3 to %4 – %5',
      SOM_MATH_MAP_TOOLTIP:
        'Changes a number from one range to another. Example: 0–1023 from a sensor to 0–255 for an LED.',
    },
  },
};
