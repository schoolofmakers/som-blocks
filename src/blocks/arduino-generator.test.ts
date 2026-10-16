import * as Blockly from 'blockly/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { arduinoGenerator, Order, toIncludeLine } from './arduino-generator';
import { registerBuiltInFamilies } from './index';
import { registerFamily } from './registry';
import type { BlockFamily } from './types';

// A test-only family that writes to every section, keyed by its KEY / CODE fields.
const sectionsFamily: BlockFamily = {
  id: 'test_sections',
  blocks: [
    {
      type: 'test_define',
      message0: 'define %1 %2',
      args0: [
        { type: 'field_input', name: 'KEY', text: '' },
        { type: 'field_input', name: 'CODE', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
    },
    {
      type: 'test_setup',
      message0: 'setup %1 %2',
      args0: [
        { type: 'field_input', name: 'KEY', text: '' },
        { type: 'field_input', name: 'CODE', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
    },
    {
      type: 'test_value',
      message0: 'value %1',
      args0: [{ type: 'field_input', name: 'CODE', text: '' }],
      output: null,
    },
  ],
  generators: {
    test_define: (block, gen) => {
      gen.addDefinition(block.getFieldValue('KEY'), block.getFieldValue('CODE'));
      return '';
    },
    test_setup: (block, gen) => {
      gen.addSetup(block.getFieldValue('KEY'), block.getFieldValue('CODE'));
      return '';
    },
    test_value: (block) => [block.getFieldValue('CODE'), Order.ATOMIC],
  },
  toolbox: [],
  messages: { es: {}, en: {} },
};

type BlockState = Blockly.serialization.blocks.State;

function stack(...blocks: BlockState[]): BlockState {
  const [first, ...rest] = blocks;
  if (!first) throw new Error('empty stack');
  return rest.length ? { ...first, next: { block: stack(...rest) } } : first;
}

function block(type: string, fields: Record<string, string>): BlockState {
  return { type, fields };
}

let workspace: Blockly.Workspace | undefined;

function generate(...topBlocks: BlockState[]): string {
  workspace?.dispose();
  workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    {
      blocks: {
        languageVersion: 0,
        blocks: topBlocks.map((b, i) => ({ ...b, x: 0, y: i * 100 })),
      },
    },
    workspace,
  );
  return arduinoGenerator.workspaceToCode(workspace);
}

beforeAll(() => {
  registerBuiltInFamilies();
  registerFamily(sectionsFamily);
});

afterEach(() => {
  workspace?.dispose();
  workspace = undefined;
});

describe('ArduinoGenerator', () => {
  it('assembles includes, definitions, setup and loop in that order', () => {
    const code = generate(
      stack(
        block('test_setup', { KEY: 'serial', CODE: 'Serial.begin(115200);' }),
        block('som_raw_statement', { CODE: 'tick();' }),
        block('test_define', { KEY: 'counter', CODE: 'int counter = 0;' }),
        block('som_raw_include', { HEADER: 'Wire.h' }),
      ),
    );
    expect(code).toBe(
      [
        '#include <Wire.h>',
        '',
        'int counter = 0;',
        '',
        'void setup() {',
        '  Serial.begin(115200);',
        '}',
        '',
        'void loop() {',
        '  tick();',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('dedupes includes and keeps first-seen order', () => {
    const code = generate(
      stack(
        block('som_raw_include', { HEADER: 'Wire.h' }),
        block('som_raw_include', { HEADER: 'SPI.h' }),
        block('som_raw_include', { HEADER: '<Wire.h>' }),
        block('som_raw_include', { HEADER: '#include <SPI.h>' }),
      ),
    );
    expect(code.startsWith('#include <Wire.h>\n#include <SPI.h>\n\nvoid setup()')).toBe(true);
  });

  it('replaces keyed definitions and setup lines in place, keeping order', () => {
    const code = generate(
      stack(
        block('test_setup', { KEY: 'a', CODE: 'first();' }),
        block('test_setup', { KEY: 'b', CODE: 'second();' }),
        block('test_setup', { KEY: 'a', CODE: 'firstAgain();' }),
        block('test_define', { KEY: 'x', CODE: 'int x;' }),
        block('test_define', { KEY: 'x', CODE: 'long x;' }),
      ),
    );
    expect(code).toContain('long x;\n\nvoid setup() {\n  firstAgain();\n  second();\n}');
    expect(code).not.toContain('int x;');
  });

  it('resets sections between runs', () => {
    generate(
      stack(
        block('som_raw_include', { HEADER: 'Servo.h' }),
        block('test_setup', { KEY: 's', CODE: 'servo.attach(9);' }),
      ),
    );
    expect(generate()).toBe('void setup() {\n}\n\nvoid loop() {\n}\n');
  });

  it('puts separate top-level stacks into loop() and terminates naked values', () => {
    const code = generate(
      block('som_raw_statement', { CODE: 'a();' }),
      block('test_value', { CODE: 'b()' }),
    );
    expect(code).toContain('void loop() {\n  a();\n\n  b();\n}');
  });

  it('turns block comments into // lines', () => {
    const code = generate({
      ...block('som_raw_statement', { CODE: 'go();' }),
      icons: { comment: { text: 'line one\nline two' } },
    });
    expect(code).toContain('  // line one\n  // line two\n  go();\n');
  });
});

describe('toIncludeLine', () => {
  it.each([
    ['Wire.h', '#include <Wire.h>'],
    ['  <Wire.h> ', '#include <Wire.h>'],
    ['"local.h"', '#include "local.h"'],
    ['#include <SPI.h>', '#include <SPI.h>'],
    ['#include"x.h"', '#include "x.h"'],
    ['', null],
    ['#include', null],
  ])('%j → %j', (input, expected) => {
    expect(toIncludeLine(input)).toBe(expected);
  });
});
