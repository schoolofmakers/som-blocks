import * as Blockly from 'blockly/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { arduinoGenerator } from './arduino-generator';
import { cppString, mergeTypes, valueType, variableType } from './cpp-types';
import { registerBuiltInFamilies } from './index';
import { applyLocale } from './registry';

// Unit tests for the variable-typing heuristic (cpp-types.ts header) and the identifier
// safety that rides on nameDB_.

type BlockState = Blockly.serialization.blocks.State;

let workspace: Blockly.Workspace | undefined;

function load(blocks: BlockState[], variables: { name: string; id: string }[]): Blockly.Workspace {
  workspace?.dispose();
  workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    {
      blocks: { languageVersion: 0, blocks: blocks.map((b, i) => ({ ...b, x: 0, y: i * 100 })) },
      variables,
    },
    workspace,
  );
  return workspace;
}

const num = (n: number): BlockState => ({ type: 'math_number', fields: { NUM: n } });
const text = (t: string): BlockState => ({ type: 'text', fields: { TEXT: t } });
const bool = (b: boolean): BlockState => ({
  type: 'logic_boolean',
  fields: { BOOL: b ? 'TRUE' : 'FALSE' },
});
const get = (id: string): BlockState => ({ type: 'variables_get', fields: { VAR: { id } } });
const set = (id: string, value?: BlockState): BlockState => ({
  type: 'variables_set',
  fields: { VAR: { id } },
  ...(value ? { inputs: { VALUE: { block: value } } } : {}),
});

beforeAll(() => {
  registerBuiltInFamilies();
  applyLocale('es');
});

afterEach(() => {
  workspace?.dispose();
  workspace = undefined;
});

describe('mergeTypes', () => {
  it.each([
    [[], null],
    [[null], null],
    [['double'], 'double'],
    [['bool', 'bool'], 'bool'],
    [['bool', 'double'], 'double'],
    [['double', 'String', 'bool'], 'String'],
    [
      ['double', { element: 'double', size: 2 }, { element: 'String', size: 5 }],
      { element: 'String', size: 5 },
    ],
  ] as const)('%j → %j', (types, expected) => {
    expect(mergeTypes([...types])).toEqual(expected);
  });
});

describe('variableType', () => {
  it('defaults to double for a number, an empty set, or no assignment at all', () => {
    const ws = load(
      [set('a', num(1)), set('b')],
      [
        { name: 'a', id: 'a' },
        { name: 'b', id: 'b' },
        { name: 'c', id: 'c' },
      ],
    );
    expect(variableType(ws, 'a')).toBe('double');
    expect(variableType(ws, 'b')).toBe('double');
    expect(variableType(ws, 'c')).toBe('double');
  });

  it('is String when any assigned value is text, even if numbers are assigned too', () => {
    const ws = load([set('s', num(1)), set('s', text('hola'))], [{ name: 's', id: 's' }]);
    expect(variableType(ws, 's')).toBe('String');
  });

  it('is String for a text_append target', () => {
    const ws = load(
      [{ type: 'text_append', fields: { VAR: { id: 's' } } }],
      [{ name: 's', id: 's' }],
    );
    expect(variableType(ws, 's')).toBe('String');
  });

  it('is bool only when every known value is true/false', () => {
    const ws = load(
      [
        set('on', bool(true)),
        set('on', { type: 'logic_negate' }),
        set('mixed', bool(true)),
        set('mixed', num(0)),
      ],
      [
        { name: 'on', id: 'on' },
        { name: 'mixed', id: 'mixed' },
      ],
    );
    expect(variableType(ws, 'on')).toBe('bool');
    expect(variableType(ws, 'mixed')).toBe('double');
  });

  it('follows a variable copied from another, and survives a cycle', () => {
    const ws = load(
      [set('a', text('x')), set('b', get('a')), set('c', get('d')), set('d', get('c'))],
      [
        { name: 'a', id: 'a' },
        { name: 'b', id: 'b' },
        { name: 'c', id: 'c' },
        { name: 'd', id: 'd' },
      ],
    );
    expect(variableType(ws, 'b')).toBe('String');
    expect(variableType(ws, 'c')).toBe('double');
  });

  it('is a fixed-size array for a list, sized by the longest one', () => {
    const list = (...items: BlockState[]): BlockState => ({
      type: 'lists_create_with',
      extraState: { itemCount: items.length },
      inputs: Object.fromEntries(items.map((item, i) => [`ADD${i}`, { block: item }])),
    });
    const ws = load(
      [set('l', list(num(1), num(2))), set('l', list(text('a'), num(2), num(3)))],
      [{ name: 'l', id: 'l' }],
    );
    expect(variableType(ws, 'l')).toEqual({ element: 'String', size: 3 });
  });

  it('types a parameter by its own function and calls, not by the global of the same name', () => {
    const ws = load(
      [
        {
          type: 'procedures_defnoreturn',
          extraState: { params: [{ name: 'x', id: 'x' }] },
          fields: { NAME: 'f' },
        },
        {
          type: 'procedures_callnoreturn',
          extraState: { name: 'f', params: ['x'] },
          inputs: { ARG0: { block: bool(true) } },
        },
        set('x', text('global')),
      ],
      [{ name: 'x', id: 'x' }],
    );
    const def = ws.getTopBlocks(true).find((b) => b.type === 'procedures_defnoreturn')!;
    expect(variableType(ws, 'x')).toBe('String');
    expect(variableType(ws, 'x', def)).toBe('bool');
  });
});

describe('valueType', () => {
  it('reads Blockly output checks', () => {
    const ws = load([num(1), text('a'), bool(true), { type: 'text_length' }], []);
    const types = ws.getTopBlocks(true).map((b) => valueType(b));
    expect(types).toEqual(['double', 'String', 'bool', 'double']);
    expect(valueType(null)).toBeNull();
  });
});

describe('cppString', () => {
  it('escapes quotes, backslashes and control characters, keeping UTF-8', () => {
    expect(cppString('dice "hola"\\\n\tñ')).toBe('"dice \\"hola\\"\\\\\\n\\tñ"');
  });
});

describe('generated identifiers', () => {
  function generate(blocks: BlockState[], variables: { name: string; id: string }[]): string {
    return arduinoGenerator.workspaceToCode(load(blocks, variables));
  }

  it('renames variables that clash with C++ or Arduino names', () => {
    const names = ['int', 'map', 'delay', 'setup', 'loop', 'String', 'HIGH'];
    const code = generate(
      names.map((name) => set(name, num(1))),
      names.map((name) => ({ name, id: name })),
    );
    for (const name of names) {
      expect(code).toContain(`double ${name}2 = 0;`);
      expect(code).toContain(`  ${name}2 = 1;`);
    }
  });

  it('keeps a function and a variable with the same name apart, and renames a reserved function', () => {
    const code = generate(
      [
        { type: 'procedures_defnoreturn', fields: { NAME: 'delay' } },
        { type: 'procedures_defnoreturn', fields: { NAME: 'luz' } },
        set('luz', num(1)),
        { type: 'procedures_callnoreturn', extraState: { name: 'luz' } },
      ],
      [{ name: 'luz', id: 'luz' }],
    );
    expect(code).toContain('void delay2() {');
    expect(code).toMatch(/void luz2?\(\) \{/);
    expect(code).toMatch(/double luz2? = 0;/);
    // The variable and the function got different C++ names.
    const fn = /void (luz2?)\(\) \{/.exec(code)![1];
    const variable = /double (luz2?) = 0;/.exec(code)![1];
    expect(fn).not.toBe(variable);
  });

  it('gives loop counters names that never take the student’s variable', () => {
    const code = generate(
      [
        set('count', num(1)),
        {
          type: 'controls_repeat_ext',
          inputs: { TIMES: { block: num(2) }, DO: { block: set('count', get('count')) } },
        },
      ],
      [{ name: 'count', id: 'count' }],
    );
    expect(code).toContain('for (long count2 = 0; count2 < 2; count2++) {');
    expect(code).toContain('    count = count;');
  });

  it('declares a parameter only in the signature; the global of the same name stays global', () => {
    const code = generate(
      [
        {
          type: 'procedures_defnoreturn',
          extraState: { params: [{ name: 'x', id: 'x' }] },
          fields: { NAME: 'f' },
          inputs: { STACK: { block: set('x', num(2)) } },
        },
        set('x', num(1)),
      ],
      [{ name: 'x', id: 'x' }],
    );
    expect(code.match(/double x = 0;/g)).toHaveLength(1);
    expect(code).toContain('void f(double x) {\n  x = 2;\n}');
    expect(code).toContain('void loop() {\n  x = 1;\n}');
  });
});

// Regressions from the PR #22 review: each case used to generate wrong or non-compiling C++.
describe('generator edge cases', () => {
  const generateCode = (blocks: BlockState[]) =>
    arduinoGenerator.workspaceToCode(
      load(blocks, [
        { name: 'n', id: 'n' },
        { name: 'l', id: 'l' },
      ]),
    );
  const list = (...items: BlockState[]): BlockState => ({
    type: 'lists_create_with',
    extraState: { itemCount: items.length },
    inputs: Object.fromEntries(items.map((item, i) => [`ADD${i}`, { block: item }])),
  });

  it('ignores disabled assignments when typing a variable', () => {
    const code = generateCode([
      { ...set('n', list(num(1), num(2))), enabled: false },
      set('n', num(3)),
    ]);
    expect(code).toContain('double n = 0;');
    expect(code).toContain('  n = 3;');
  });

  it('lets `set item` to text make the list a String array', () => {
    const code = generateCode([
      set('l', list(num(1), num(2))),
      {
        type: 'lists_setIndex',
        fields: { MODE: 'SET', WHERE: 'FIRST' },
        inputs: { LIST: { block: get('l') }, TO: { block: text('hola') } },
      },
    ]);
    expect(code).toContain('String l[2];');
    expect(code).toContain('  l[0] = String(1);');
    expect(code).toContain('  l[0] = "hola";');
  });

  it('refuses lists of different lengths for one variable instead of keeping stale items', () => {
    const code = generateCode([set('l', list(num(1), num(2), num(3))), set('l', list(num(4)))]);
    expect(code).toMatch(/#error ".*mismo número de elementos/);
  });

  it('flags an inline list in `length of` instead of dropping its items', () => {
    const code = generateCode([
      set('n', { type: 'lists_length', inputs: { VALUE: { block: list(num(1)) } } }),
    ]);
    expect(code).toContain('#error');
  });

  it('makes both ternary choices Strings when either is text', () => {
    const code = generateCode([
      set('l', text('a')),
      set('n', {
        type: 'logic_ternary',
        inputs: { IF: { block: bool(true) }, THEN: { block: get('l') }, ELSE: { block: num(2) } },
      }),
    ]);
    expect(code).toContain('n = true ? l : String(2);');
  });

  it('reads a computed repeat count once and counts with a long', () => {
    const code = generateCode([
      { type: 'controls_repeat_ext', inputs: { TIMES: { block: get('n') } } },
    ]);
    expect(code).toContain(
      'double count_times = n;\n  for (long count = 0; count < count_times; count++) {',
    );
  });

  it('keeps integer-literal arithmetic in double (no 16-bit overflow)', () => {
    const code = generateCode([
      set('n', {
        type: 'math_arithmetic',
        fields: { OP: 'MULTIPLY' },
        inputs: { A: { block: num(300) }, B: { block: num(300) } },
      }),
    ]);
    expect(code).toContain('n = 300.0 * 300;');

    // An int-valued Arduino result (String::length) times a literal stays double too.
    const mixed = generateCode([
      set('n', {
        type: 'math_arithmetic',
        fields: { OP: 'MULTIPLY' },
        inputs: {
          A: { block: { type: 'text_length', inputs: { VALUE: { block: text('abc') } } } },
          B: { block: num(300) },
        },
      }),
    ]);
    expect(mixed).toContain('n = String("abc").length() * 300.0;');
  });

  it('orders random bounds: literal ones now, computed ones in a helper', () => {
    const random = (from: BlockState, to: BlockState): BlockState => ({
      type: 'math_random_int',
      inputs: { FROM: { block: from }, TO: { block: to } },
    });
    const code = generateCode([
      set('n', random(num(6), num(1))),
      set('l', random(get('n'), num(1))),
    ]);
    expect(code).toContain('n = random(1, 7);');
    expect(code).toContain('long randomInt(double a, double b) {');
    expect(code).toContain('l = randomInt(n, 1);');
  });

  it('treats only a remainder of ±1 as odd', () => {
    const code = generateCode([
      set('n', {
        type: 'math_number_property',
        fields: { PROPERTY: 'ODD' },
        inputs: { NUMBER_TO_CHECK: { block: num(2.5) } },
      }),
    ]);
    expect(code).toContain('fabs(fmod(2.5, 2)) == 1');
  });

  it('types long variable chains in linear time', () => {
    // a0 = 1; each a(i) is assigned a(i-1) twice: without memoising, every lookup doubles.
    const depth = 40;
    const variables = Array.from({ length: depth }, (_, i) => ({ name: `a${i}`, id: `a${i}` }));
    const blocks: BlockState[] = [set('a0', num(1))];
    for (let i = 1; i < depth; i++)
      blocks.push(set(`a${i}`, get(`a${i - 1}`)), set(`a${i}`, get(`a${i - 1}`)));
    const ws = load(blocks, variables);
    const start = performance.now();
    expect(variableType(ws, `a${depth - 1}`)).toBe('double');
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('refuses counting with a text variable, and changes a text variable numerically', () => {
    const code = generateCode([
      set('n', text('hola')),
      {
        type: 'controls_for',
        fields: { VAR: { id: 'n' } },
        inputs: { FROM: { block: num(1) }, TO: { block: num(3) }, BY: { block: num(1) } },
      },
      { type: 'math_change', fields: { VAR: { id: 'n' } }, inputs: { DELTA: { block: num(1) } } },
    ]);
    expect(code).toMatch(/#error ".*contar con/);
    expect(code).not.toContain('for (n =');
    expect(code).toContain('n = String(n.toDouble() + 1);');
  });

  it('uses constrain() only for plain arguments; calls go through a helper', () => {
    const constrain = (value: BlockState): BlockState => ({
      type: 'math_constrain',
      inputs: { VALUE: { block: value }, LOW: { block: num(0) }, HIGH: { block: num(10) } },
    });
    const code = generateCode([
      set('n', constrain(get('n'))),
      set(
        'l',
        constrain({
          type: 'math_random_int',
          inputs: { FROM: { block: get('n') }, TO: { block: num(20) } },
        }),
      ),
    ]);
    expect(code).toContain('n = constrain(n, 0, 10);');
    expect(code).toContain('l = constrainValue(randomInt(n, 20), 0, 10);');
  });

  it('converts a text variable used as a number with toDouble()', () => {
    const code = generateCode([
      set('l', text('42')),
      set('n', {
        type: 'math_arithmetic',
        fields: { OP: 'DIVIDE' },
        inputs: { A: { block: get('l') }, B: { block: num(2) } },
      }),
    ]);
    expect(code).toContain('n = l.toDouble() / 2.0;');
  });

  it('rounds with floor(x + 0.5), never the AVR round() macro', () => {
    const code = generateCode([
      set('n', {
        type: 'math_round',
        fields: { OP: 'ROUND' },
        inputs: { NUM: { block: get('l') } },
      }),
    ]);
    expect(code).toContain('n = floor(l + 0.5);');
  });
});
