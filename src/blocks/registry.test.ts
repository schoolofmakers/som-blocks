import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { arduinoGenerator } from './arduino-generator';
import { rawFamily } from './families/raw';
import { BUILT_IN_FAMILIES, registerBuiltInFamilies } from './index';
import { applyLocale, buildToolbox, registerFamily } from './registry';
import type { BlockFamily } from './types';

beforeAll(() => {
  registerBuiltInFamilies();
});

describe('registerFamily', () => {
  it('defines blocks and attaches generators', () => {
    expect(Blockly.Blocks['som_raw_statement']).toBeDefined();
    expect(arduinoGenerator.forBlock['som_raw_include']).toBe(
      rawFamily.generators['som_raw_include'],
    );
  });

  it('is idempotent for the same family object', () => {
    expect(() => registerFamily(rawFamily)).not.toThrow();
  });

  it('refuses a second family with the same id', () => {
    expect(() => registerFamily({ ...rawFamily })).toThrow(/already registered/);
  });

  it('refuses a block type owned by another family', () => {
    const thief: BlockFamily = { ...rawFamily, id: 'thief' };
    expect(() => registerFamily(thief)).toThrow(/owned by "raw"/);
  });

  it('refuses a generator for a block the family does not declare', () => {
    const original = arduinoGenerator.forBlock['som_raw_statement'];
    const hijack: BlockFamily = {
      id: 'hijack',
      blocks: [{ type: 'hijack_block', message0: 'x' }],
      generators: { hijack_block: () => '', som_raw_statement: () => 'evil();\n' },
      toolbox: [],
      messages: { es: {}, en: {} },
    };
    expect(() => registerFamily(hijack)).toThrow(/has no block in that family/);
    expect(arduinoGenerator.forBlock['som_raw_statement']).toBe(original);
    expect(Blockly.Blocks['hijack_block']).toBeUndefined();
  });

  it('refuses a block without a generator', () => {
    const broken: BlockFamily = {
      id: 'broken',
      blocks: [{ type: 'broken_block', message0: 'x' }],
      generators: {},
      toolbox: [],
      messages: { es: {}, en: {} },
    };
    expect(() => registerFamily(broken)).toThrow(/no generator/);
    expect(Blockly.Blocks['broken_block']).toBeUndefined();
  });
});

describe('applyLocale', () => {
  it('loads Blockly core and family messages for the language', () => {
    applyLocale('en');
    expect(Blockly.Msg['SOM_RAW_CATEGORY']).toBe('Code');
    expect(Blockly.Msg['DELETE_BLOCK']).toBe('Delete Block');
    applyLocale('es');
    expect(Blockly.Msg['SOM_RAW_CATEGORY']).toBe('Código');
    expect(Blockly.Msg['DELETE_BLOCK']).toBe('Eliminar bloque');
  });

  it('every family has the same message keys in es and en', () => {
    for (const family of BUILT_IN_FAMILIES) {
      expect(Object.keys(family.messages.en).sort()).toEqual(
        Object.keys(family.messages.es).sort(),
      );
    }
  });
});

describe('buildToolbox', () => {
  it('builds a category toolbox from the registered families', () => {
    const toolbox = buildToolbox() as unknown as {
      kind: string;
      contents: { kind: string; name: string }[];
    };
    expect(toolbox.kind).toBe('categoryToolbox');
    expect(toolbox.contents).toContainEqual(
      expect.objectContaining({ kind: 'category', name: '%{BKY_SOM_RAW_CATEGORY}' }),
    );
  });
});
