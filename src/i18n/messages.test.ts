import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGS, t, UI_MESSAGES } from './messages';

describe('t', () => {
  const saved = UI_MESSAGES.en.UI_SAVE;

  afterEach(() => {
    UI_MESSAGES.en.UI_SAVE = saved;
    vi.restoreAllMocks();
  });

  it('returns the translation for the language', () => {
    expect(t('UI_SAVE', 'es')).toBe('Guardar');
    expect(t('UI_SAVE', 'en')).toBe('Save');
  });

  it('falls back to es for a key missing in the language, warning once in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete UI_MESSAGES.en.UI_SAVE;
    expect(t('UI_SAVE', 'en')).toBe('Guardar');
    expect(t('UI_SAVE', 'en')).toBe('Guardar');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('UI key "UI_SAVE" has no "en" translation');
  });

  it('has a dictionary for every supported language', () => {
    expect(Object.keys(UI_MESSAGES).sort()).toEqual([...SUPPORTED_LANGS].sort());
  });
});
