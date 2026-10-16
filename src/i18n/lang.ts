import { DEFAULT_LANG, SUPPORTED_LANGS, type Lang } from './messages';

export const LANG_STORAGE_KEY = 'som-blocks.lang';

function toLang(value: string | null | undefined): Lang | undefined {
  if (!value) return undefined;
  const base = value.trim().toLowerCase().split('-')[0];
  return SUPPORTED_LANGS.find((lang) => lang === base);
}

export interface LangSources {
  search?: string;
  stored?: string | null;
  browser?: string;
}

// Precedence from _config/i18n.md: URL `?lang=` > saved preference > browser language > `es`.
export function resolveLang({ search, stored, browser }: LangSources): Lang {
  const fromUrl = search ? new URLSearchParams(search).get('lang') : null;
  return toLang(fromUrl) ?? toLang(stored) ?? toLang(browser) ?? DEFAULT_LANG;
}

function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode, site data disabled); fall through.
    return null;
  }
}

export function detectLang(): Lang {
  return resolveLang({
    search: window.location.search,
    stored: readStoredLang(),
    browser: window.navigator.language,
  });
}
