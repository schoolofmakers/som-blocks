import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { arduinoGenerator } from './arduino-generator';
import { logicFamily } from './families/logic';
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

  it('registers family extensions and refuses one already registered', () => {
    expect(Blockly.Extensions.isRegistered('som_wifi_tooltip')).toBe(true);
    const clash: BlockFamily = {
      id: 'clash',
      blocks: [{ type: 'clash_block', message0: 'x' }],
      generators: { clash_block: () => '' },
      toolbox: [],
      messages: { es: {}, en: {} },
      extensions: { som_wifi_tooltip: () => undefined },
    };
    expect(() => registerFamily(clash)).toThrow(/Extension "som_wifi_tooltip"/);
    expect(Blockly.Blocks['clash_block']).toBeUndefined();
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

  it('falls back to es for a family key missing in the language, warning once in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const partial: BlockFamily = {
      id: 'partial_i18n',
      blocks: [{ type: 'partial_i18n_block', message0: '%{BKY_PARTIAL_I18N_LABEL}' }],
      generators: { partial_i18n_block: () => '' },
      toolbox: [],
      messages: {
        es: { PARTIAL_I18N_LABEL: 'etiqueta', PARTIAL_I18N_DONE: 'hecho' },
        en: { PARTIAL_I18N_DONE: 'done' },
      },
    };
    registerFamily(partial);
    applyLocale('en');
    applyLocale('en');
    expect(Blockly.Msg['PARTIAL_I18N_LABEL']).toBe('etiqueta');
    expect(Blockly.Msg['PARTIAL_I18N_DONE']).toBe('done');
    const warnings = warn.mock.calls.filter(([text]) => String(text).includes('PARTIAL_I18N'));
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('family "partial_i18n" key "PARTIAL_I18N_LABEL"');
    applyLocale('es');
    warn.mockRestore();
  });

  it('every family has the same message keys in es and en', () => {
    for (const family of BUILT_IN_FAMILIES) {
      expect(Object.keys(family.messages.en).sort()).toEqual(
        Object.keys(family.messages.es).sort(),
      );
    }
  });
});

describe('externalBlocks', () => {
  const base = { blocks: [], toolbox: [], messages: { es: {}, en: {} } };

  it('attaches generators for core Blockly blocks the family lists', () => {
    expect(Blockly.Blocks['controls_if']).toBeDefined();
    expect(arduinoGenerator.forBlock['controls_if']).toBe(logicFamily.generators['controls_if']);
  });

  it('refuses a core block another family already provides', () => {
    const copy: BlockFamily = {
      ...base,
      id: 'logic_copy',
      externalBlocks: ['controls_if'],
      generators: { controls_if: () => '' },
    };
    expect(() => registerFamily(copy)).toThrow(/owned by "logic"/);
  });

  it('refuses claiming another family’s own block as external', () => {
    const thief: BlockFamily = {
      ...base,
      id: 'raw_thief',
      externalBlocks: ['som_raw_statement'],
      generators: { som_raw_statement: () => '' },
    };
    expect(() => registerFamily(thief)).toThrow(/owned by "raw"/);
  });

  it('refuses an external block Blockly does not define', () => {
    const ghost: BlockFamily = {
      ...base,
      id: 'ghost',
      externalBlocks: ['no_such_block'],
      generators: { no_such_block: () => '' },
    };
    expect(() => registerFamily(ghost)).toThrow(/is not defined/);
  });

  it('refuses an external block without a generator', () => {
    const lazy: BlockFamily = {
      ...base,
      id: 'lazy',
      externalBlocks: ['lists_repeat'],
      generators: {},
    };
    expect(() => registerFamily(lazy)).toThrow(/no generator/);
    // A failed registration leaves nothing behind: another family can still claim it.
    expect(arduinoGenerator.forBlock['lists_repeat']).toBeUndefined();
  });
});

type ToolboxJson = { kind: string; name?: string; contents?: ToolboxJson[]; type?: string };

function categories(profile?: 'starter' | 'full'): ToolboxJson[] {
  const toolbox = buildToolbox(profile) as unknown as ToolboxJson;
  expect(toolbox.kind).toBe('categoryToolbox');
  return toolbox.contents ?? [];
}

function blockTypes(category: ToolboxJson | undefined): string[] {
  return (category?.contents ?? []).flatMap((item) => (item.type ? [item.type] : []));
}

describe('buildToolbox', () => {
  it('starter (the default) lists the categories in order, without lists or raw', () => {
    expect(categories().map((c) => c.name)).toEqual([
      '%{BKY_SOM_LOGIC_CATEGORY}',
      '%{BKY_SOM_CONTROL_CATEGORY}',
      '%{BKY_SOM_MATH_CATEGORY}',
      '%{BKY_SOM_TEXT_CATEGORY}',
      '%{BKY_SOM_VARIABLES_CATEGORY}',
      '%{BKY_SOM_FUNCTIONS_CATEGORY}',
      '%{BKY_SOM_IO_CATEGORY}',
      '%{BKY_SOM_TIME_CATEGORY}',
      '%{BKY_SOM_SERIAL_CATEGORY}',
      '%{BKY_SOM_WIFI_CATEGORY}',
      '%{BKY_SOM_ESPNOW_CATEGORY}',
    ]);
    expect(categories('starter')).toEqual(categories());
  });

  it('full adds lists, Bluetooth and raw code, in toolbox order', () => {
    expect(categories('full').map((c) => c.name)).toEqual([
      '%{BKY_SOM_LOGIC_CATEGORY}',
      '%{BKY_SOM_CONTROL_CATEGORY}',
      '%{BKY_SOM_MATH_CATEGORY}',
      '%{BKY_SOM_TEXT_CATEGORY}',
      '%{BKY_SOM_VARIABLES_CATEGORY}',
      '%{BKY_SOM_LISTS_CATEGORY}',
      '%{BKY_SOM_FUNCTIONS_CATEGORY}',
      '%{BKY_SOM_IO_CATEGORY}',
      '%{BKY_SOM_TIME_CATEGORY}',
      '%{BKY_SOM_SERIAL_CATEGORY}',
      '%{BKY_SOM_WIFI_CATEGORY}',
      '%{BKY_SOM_ESPNOW_CATEGORY}',
      '%{BKY_SOM_BLE_CATEGORY}',
      '%{BKY_SOM_RAW_CATEGORY}',
    ]);
  });

  it('starter hides the advanced blocks inside a category; full shows them', () => {
    const math = (profile: 'starter' | 'full') =>
      blockTypes(categories(profile).find((c) => c.name === '%{BKY_SOM_MATH_CATEGORY}'));
    expect(math('starter')).toEqual([
      'math_number',
      'math_arithmetic',
      'math_random_int',
      'som_math_map',
      'math_constrain',
    ]);
    expect(math('full')).toEqual(expect.arrayContaining(['math_single', 'math_trig']));
  });

  it('every block in the full toolbox has a generator', () => {
    const types = categories('full').flatMap(blockTypes);
    expect(types.length).toBeGreaterThan(20);
    for (const type of types) expect(arduinoGenerator.forBlock[type], type).toBeTypeOf('function');
  });

  it('hardware blocks come with number / text shadows in their value inputs', () => {
    const shadowOf = (type: string, input: string) => {
      const block = categories('full')
        .flatMap((c) => c.contents ?? [])
        .find((item) => item.type === type) as
        { inputs?: Record<string, { shadow?: { type: string } }> } | undefined;
      return block?.inputs?.[input]?.shadow?.type;
    };
    expect(shadowOf('som_time_delay_ms', 'MS')).toBe('math_number');
    expect(shadowOf('som_time_every', 'MS')).toBe('math_number');
    expect(shadowOf('som_io_analog_write', 'VALUE')).toBe('math_number');
    expect(shadowOf('som_serial_println', 'VALUE')).toBe('text');
  });

  it('never passes our fullOnly flag to Blockly', () => {
    expect(JSON.stringify(buildToolbox('full'))).not.toContain('fullOnly');
  });

  it('keeps dynamic categories (variables, functions) although they list no blocks', () => {
    expect(categories()).toContainEqual(
      expect.objectContaining({ name: '%{BKY_SOM_VARIABLES_CATEGORY}', custom: 'VARIABLE' }),
    );
  });
});
