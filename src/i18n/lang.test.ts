import { afterEach, describe, expect, it } from 'vitest';
import { chooseLang, detectLang, LANG_STORAGE_KEY, resolveLang } from './lang';

describe('resolveLang', () => {
  it('defaults to es with no signals', () => {
    expect(resolveLang({})).toBe('es');
  });

  it('prefers ?lang= over saved preference and browser language', () => {
    expect(resolveLang({ search: '?lang=en', stored: 'es', browser: 'es-CL' })).toBe('en');
  });

  it('prefers saved preference over browser language', () => {
    expect(resolveLang({ stored: 'en', browser: 'es-CL' })).toBe('en');
  });

  it('uses the base of the browser language', () => {
    expect(resolveLang({ browser: 'en-US' })).toBe('en');
  });

  it('skips unsupported values and falls back to es', () => {
    expect(resolveLang({ search: '?lang=xx', stored: 'fr', browser: 'de-DE' })).toBe('es');
  });
});

describe('chooseLang', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('saves the choice so the next load picks it up over the browser language', () => {
    // jsdom's browser language is en-US.
    chooseLang('es');
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('es');
    expect(detectLang()).toBe('es');
  });

  it('drops ?lang= from the address so a reload keeps the choice', () => {
    window.history.replaceState(null, '', '/?toolbox=full&lang=es');
    chooseLang('en');
    expect(window.location.search).toBe('?toolbox=full');
    expect(detectLang()).toBe('en');
  });
});
