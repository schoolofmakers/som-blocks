import { describe, expect, it } from 'vitest';
import { resolveLang } from './lang';

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
