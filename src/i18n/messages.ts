// Seed of the UI message layer (see _config/i18n.md). Flat keys, `es` is the source
// language and the fallback. Full plumbing (JSON per locale, untranslated-key CI check,
// language switch) arrives in B11; keep this file to the keys the shell needs.

const es = {
  UI_APP_TITLE: 'SoM Blocks',
  UI_TAGLINE: 'Programa tu placa con bloques',
  UI_WORKSPACE_LABEL: 'Espacio de bloques',
  UI_GENERATED_CODE: 'Código generado',
  UI_FOOTER: 'Hecho por School of Makers',
} as const;

export type MessageKey = keyof typeof es;

// Partial so a missing translation is a fallback to `es`, not a type error.
const en: Partial<Record<MessageKey, string>> = {
  UI_APP_TITLE: 'SoM Blocks',
  UI_TAGLINE: 'Program your board with blocks',
  UI_WORKSPACE_LABEL: 'Blocks workspace',
  UI_GENERATED_CODE: 'Generated code',
  UI_FOOTER: 'Made by School of Makers',
};

export const SUPPORTED_LANGS = ['es', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';

const messages: Record<Lang, Partial<Record<MessageKey, string>>> = { es, en };

export function t(key: MessageKey, lang: Lang = DEFAULT_LANG): string {
  return messages[lang][key] ?? es[key];
}
