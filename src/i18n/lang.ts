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

/**
 * Each language's own name (autonym), shown as-is in every UI language so a student can find
 * their language whatever the screen is in. Names, not flags: a flag is a country.
 */
export const LANG_NAMES: Record<Lang, string> = {
  es: 'Español',
  en: 'English',
};

/**
 * The student picked `lang` in the switch: remember it, and drop a `?lang=` from the address
 * so a reload keeps the choice (`?lang=` only wins for the page load it came with).
 */
export function chooseLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Storage blocked: the switch still works for this page.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    window.history.replaceState(window.history.state, '', url);
  }
}

export function detectLang(): Lang {
  return resolveLang({
    search: window.location.search,
    stored: readStoredLang(),
    browser: window.navigator.language,
  });
}
