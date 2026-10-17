import { LANG_NAMES } from './lang';
import { SUPPORTED_LANGS, t, type Lang } from './messages';

interface LanguageSwitchProps {
  lang: Lang;
  onChange: (lang: Lang) => void;
}

/**
 * Header segmented control: one toggle button per supported language, labelled with the
 * language's own name. Plain buttons, so Tab / Enter / Space work without extra key handling.
 */
export function LanguageSwitch({ lang, onChange }: LanguageSwitchProps) {
  return (
    <div
      role="group"
      aria-label={t('UI_LANGUAGE', lang)}
      className="flex overflow-hidden rounded-md border border-border text-sm"
    >
      {SUPPORTED_LANGS.map((option) => {
        const active = option === lang;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(option);
            }}
            className={`min-h-11 px-3 ${active ? 'bg-accent font-semibold text-bg' : 'bg-bg text-fg hover:bg-surface'}`}
          >
            {LANG_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
