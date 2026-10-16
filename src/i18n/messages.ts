// Seed of the UI message layer (see _config/i18n.md). Flat keys, `es` is the source
// language and the fallback. Full plumbing (JSON per locale, untranslated-key CI check,
// language switch) arrives in B11; keep this file to the keys the shell needs.

const es = {
  UI_APP_TITLE: 'SoM Blocks',
  UI_TAGLINE: 'Programa tu placa con bloques',
  UI_WORKSPACE_LABEL: 'Espacio de bloques',
  UI_GENERATED_CODE: 'Código generado',
  UI_FOOTER: 'Hecho por School of Makers',
  UI_BOARD_LABEL: 'Placa',
  UI_BOARD_VARIANT_OLD_BOOTLOADER: 'bootloader viejo',
  UI_COMPILE: 'Compilar',
  UI_COMPILING: 'Compilando…',
  UI_COMPILE_OUTPUT: 'Salida del compilador',
  UI_COMPILE_IDLE: 'Pulsa Compilar para revisar tu programa.',
  UI_COMPILE_RUNNING: 'Compilando… puede tardar hasta 30 segundos.',
  UI_COMPILE_OK_AVR: 'Listo en {seconds} s · firmware {bytes} bytes',
  UI_COMPILE_OK_ESP: 'Listo en {seconds} s · {count} imágenes ({bytes} bytes)',
  UI_COMPILE_ERR_NO_FIRMWARE: 'Tu programa tiene errores. Lee la salida del compilador.',
  UI_COMPILE_ERR_SERVER: 'El servidor de compilación dio un error: {message}',
  UI_COMPILE_ERR_TIMEOUT: 'El servidor no respondió en {seconds} s. Inténtalo otra vez.',
  UI_COMPILE_ERR_NETWORK:
    'No se pudo conectar con el servidor de compilación ({url}). Revisa tu internet.',
  UI_COMPILE_ERR_EMPTY:
    'El servidor respondió vacío. Inténtalo otra vez; si se repite, avísale a tu profe.',
  UI_COMPILE_ERR_DURATION: 'Falló después de {seconds} s',
  UI_COPY_LOG: 'Copiar',
  UI_COPIED: 'Copiado',
  UI_SERVER_SETTINGS: 'Servidor',
  UI_SERVER_URL: 'Dirección del servidor de compilación',
  UI_SAVE: 'Guardar',
  UI_RESET_DEFAULT: 'Usar el predeterminado',
} as const;

export type MessageKey = keyof typeof es;

// Partial so a missing translation is a fallback to `es`, not a type error.
const en: Partial<Record<MessageKey, string>> = {
  UI_APP_TITLE: 'SoM Blocks',
  UI_TAGLINE: 'Program your board with blocks',
  UI_WORKSPACE_LABEL: 'Blocks workspace',
  UI_GENERATED_CODE: 'Generated code',
  UI_FOOTER: 'Made by School of Makers',
  UI_BOARD_LABEL: 'Board',
  UI_BOARD_VARIANT_OLD_BOOTLOADER: 'old bootloader',
  UI_COMPILE: 'Compile',
  UI_COMPILING: 'Compiling…',
  UI_COMPILE_OUTPUT: 'Compiler output',
  UI_COMPILE_IDLE: 'Press Compile to check your program.',
  UI_COMPILE_RUNNING: 'Compiling… this can take up to 30 seconds.',
  UI_COMPILE_OK_AVR: 'Done in {seconds} s · firmware {bytes} bytes',
  UI_COMPILE_OK_ESP: 'Done in {seconds} s · {count} images ({bytes} bytes)',
  UI_COMPILE_ERR_NO_FIRMWARE: 'Your program has errors. Read the compiler output.',
  UI_COMPILE_ERR_SERVER: 'The compile server reported an error: {message}',
  UI_COMPILE_ERR_TIMEOUT: 'The server did not answer within {seconds} s. Try again.',
  UI_COMPILE_ERR_NETWORK: 'Could not reach the compile server ({url}). Check your internet.',
  UI_COMPILE_ERR_EMPTY:
    'The server sent an empty answer. Try again; if it keeps happening, tell your teacher.',
  UI_COMPILE_ERR_DURATION: 'Failed after {seconds} s',
  UI_COPY_LOG: 'Copy',
  UI_COPIED: 'Copied',
  UI_SERVER_SETTINGS: 'Server',
  UI_SERVER_URL: 'Compile server address',
  UI_SAVE: 'Save',
  UI_RESET_DEFAULT: 'Use the default',
};

export const SUPPORTED_LANGS = ['es', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';

const messages: Record<Lang, Partial<Record<MessageKey, string>>> = { es, en };

export function t(key: MessageKey, lang: Lang = DEFAULT_LANG): string {
  return messages[lang][key] ?? es[key];
}

/** Fills `{name}` placeholders. Interim helper until the B11 message plumbing. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
