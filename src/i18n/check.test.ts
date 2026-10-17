import { describe, expect, it } from 'vitest';
import { checkI18n, formatFindings, type I18nCheckInput } from './check';

// Fixture keys are prefixed FX_ so they can never collide with real dictionary keys.
function fixture(overrides: Partial<I18nCheckInput> = {}): I18nCheckInput {
  return {
    langs: ['es', 'en'],
    ui: {
      es: { FX_UI_TITLE: 'Título', FX_UI_SAVE: 'Guardar' },
      en: { FX_UI_TITLE: 'Title', FX_UI_SAVE: 'Save' },
    },
    families: [
      {
        id: 'fx',
        messages: { es: { FX_BLOCK: 'bloque %1' }, en: { FX_BLOCK: 'block %1' } },
        blocks: [{ type: 'fx_block', message0: '%{BKY_FX_BLOCK}', tooltip: '%{BKY_MATH_X}' }],
        toolbox: { kind: 'category', name: '%{bky_fx_block}', contents: [] },
      },
    ],
    coreKeys: new Set(['MATH_X']),
    sources: [
      { path: 'src/App.tsx', text: 't(\'FX_UI_TITLE\', lang); t("FX_UI_SAVE")' },
      { path: 'src/fx.ts', text: "message0: '%{BKY_FX_BLOCK}'" },
    ],
    ...overrides,
  };
}

describe('checkI18n', () => {
  it('passes a consistent fixture', () => {
    expect(checkI18n(fixture())).toEqual([]);
  });

  it('reports a key missing in a translation and a key only in a translation', () => {
    const findings = checkI18n(
      fixture({
        ui: {
          es: { FX_UI_TITLE: 'Título', FX_UI_SAVE: 'Guardar' },
          en: { FX_UI_TITLE: 'Title', FX_UI_EXTRA: 'Extra' },
        },
        sources: [{ path: 'src/a.ts', text: "'FX_UI_TITLE' 'FX_UI_SAVE' '%{BKY_FX_BLOCK}'" }],
      }),
    );
    expect(findings).toEqual([
      { kind: 'missing', scope: 'UI', lang: 'en', key: 'FX_UI_SAVE' },
      { kind: 'extra', scope: 'UI', lang: 'en', key: 'FX_UI_EXTRA' },
    ]);
  });

  it('reports a family key missing in a translation', () => {
    const base = fixture();
    const family = { ...base.families[0]!, messages: { es: { FX_BLOCK: 'bloque' }, en: {} } };
    expect(checkI18n({ ...base, families: [family] })).toEqual([
      { kind: 'missing', scope: 'family "fx"', lang: 'en', key: 'FX_BLOCK' },
    ]);
  });

  it('reports a dead key that nothing names', () => {
    const findings = checkI18n(
      fixture({ sources: [{ path: 'src/App.tsx', text: "t('FX_UI_TITLE'); '%{BKY_FX_BLOCK}'" }] }),
    );
    expect(findings).toEqual([{ kind: 'dead', scope: 'UI', key: 'FX_UI_SAVE' }]);
  });

  it('is conservative: any whole string literal or %{BKY_…} anywhere counts as a use', () => {
    const findings = checkI18n(
      fixture({
        sources: [
          // A key in a lookup table, a test, and a template literal all count.
          { path: 'src/table.ts', text: "const KEYS = { ok: 'FX_UI_TITLE' };" },
          { path: 'e2e/x.spec.ts', text: 'expect(`FX_UI_SAVE`)' },
          { path: 'src/fx.ts', text: '"%{bky_fx_block}"' },
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  it('does not count a key that only appears inside a longer string or as an identifier', () => {
    const findings = checkI18n(
      fixture({
        sources: [
          { path: 'src/a.ts', text: "'FX_UI_TITLE' '%{BKY_FX_BLOCK}' 'FX_UI_SAVE_OLD' FX_UI_SAVE" },
        ],
      }),
    );
    expect(findings).toEqual([{ kind: 'dead', scope: 'UI', key: 'FX_UI_SAVE' }]);
  });

  it('treats a family override of a Blockly core message as used', () => {
    const base = fixture();
    const family = {
      ...base.families[0]!,
      messages: {
        es: { FX_BLOCK: 'bloque', MATH_X: 'x' },
        en: { FX_BLOCK: 'block', MATH_X: 'x' },
      },
    };
    expect(checkI18n({ ...base, families: [family] })).toEqual([]);
  });

  it('reports a %{BKY_…} reference with no message in the family or Blockly core', () => {
    const base = fixture();
    const family = {
      ...base.families[0]!,
      toolbox: { kind: 'category', name: '%{BKY_FX_MISSING_CATEGORY}', contents: [] },
    };
    expect(checkI18n({ ...base, families: [family] })).toEqual([
      { kind: 'unresolved', scope: 'family "fx"', key: 'FX_MISSING_CATEGORY' },
    ]);
  });
});

describe('formatFindings', () => {
  it('groups findings under readable headings', () => {
    const text = formatFindings([
      { kind: 'missing', scope: 'UI', lang: 'en', key: 'FX_A' },
      { kind: 'dead', scope: 'family "fx"', key: 'FX_B' },
    ]);
    expect(text).toBe(
      [
        'Missing translations (the source language has the key, this language does not):',
        '  - UI [en]: FX_A',
        'Unused keys (no string literal or %{BKY_…} reference anywhere in src/ or e2e/):',
        '  - family "fx": FX_B',
      ].join('\n'),
    );
  });

  it('is empty without findings', () => {
    expect(formatFindings([])).toBe('');
  });
});
