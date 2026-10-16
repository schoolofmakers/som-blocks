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
  UI_CONNECT_STATUS_DISCONNECTED: 'Conectar',
  UI_CONNECT_STATUS_CONNECTING: 'Conectando…',
  UI_CONNECT_STATUS_CONNECTED: 'Conectada',
  UI_CONNECT_STATUS_ERROR: 'Sin conexión',
  UI_CONNECT_TITLE: 'Conectar tu placa',
  UI_CONNECT_CLOSE: 'Cerrar',
  UI_CONNECT_BOARD: 'Placa elegida',
  UI_CONNECT_SUPPORT_TITLE: 'Qué funciona en este navegador',
  UI_CONNECT_ROW_USB: 'USB (cable)',
  UI_CONNECT_ROW_WIFI: 'WiFi',
  UI_CONNECT_USB_YES: 'Disponible',
  UI_CONNECT_USB_NO: 'No disponible',
  UI_CONNECT_WIFI_COMING: 'Próximamente',
  UI_CONNECT_USB_BUTTON: 'Conectar por USB',
  UI_CONNECT_ANY_PORT_HINT: '¿No aparece tu placa en la lista?',
  UI_CONNECT_ANY_PORT_BUTTON: 'Mostrar todos los puertos',
  UI_CONNECT_REMEMBERED: 'Placas que ya usaste',
  UI_CONNECT_RECONNECT: 'Reconectar',
  UI_CONNECT_CONNECTED_TO: 'Conectada a',
  UI_CONNECT_UNKNOWN_PORT: 'puerto serie',
  UI_CONNECT_DISCONNECT: 'Desconectar',
  UI_SUPPORT_REASON_IOS:
    'En iPhone y iPad ningún navegador puede usar USB. Pronto podrás subir programas por WiFi.',
  UI_SUPPORT_REASON_ANDROID:
    'En Android el navegador no puede usar USB. Pronto podrás subir programas por WiFi.',
  UI_SUPPORT_REASON_FIREFOX: 'Firefox no puede usar USB. Abre el editor en Chrome o Edge.',
  UI_SUPPORT_REASON_SAFARI: 'Safari no puede usar USB. Abre el editor en Chrome o Edge.',
  UI_SUPPORT_REASON_NO_SERIAL:
    'Este navegador no deja usar USB aquí. Abre el editor en Chrome o Edge actualizado, en un computador.',
  UI_CONNECT_ERROR_UNSUPPORTED: 'Este navegador no puede usar USB.',
  UI_CONNECT_ERROR_CANCELLED:
    'No elegiste ningún puerto. Si tu placa no aparece, prueba con «Mostrar todos los puertos».',
  UI_CONNECT_ERROR_BLOCKED:
    'El navegador bloqueó el acceso USB. Revisa los permisos del sitio y vuelve a intentar.',
  UI_CONNECT_ERROR_OPEN_FAILED:
    'No se pudo abrir el puerto. Cierra otras pestañas o el Arduino IDE si lo están usando, y vuelve a intentar.',
  UI_CONNECT_ERROR_DISCONNECTED: 'Se desconectó la placa. Revisa el cable y vuelve a conectar.',
  UI_CONNECT_ERROR_UNKNOWN: 'Algo falló al conectar. Desconecta el cable y vuelve a intentar.',
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
  UI_CONNECT_STATUS_DISCONNECTED: 'Connect',
  UI_CONNECT_STATUS_CONNECTING: 'Connecting…',
  UI_CONNECT_STATUS_CONNECTED: 'Connected',
  UI_CONNECT_STATUS_ERROR: 'Not connected',
  UI_CONNECT_TITLE: 'Connect your board',
  UI_CONNECT_CLOSE: 'Close',
  UI_CONNECT_BOARD: 'Selected board',
  UI_CONNECT_SUPPORT_TITLE: 'What works in this browser',
  UI_CONNECT_ROW_USB: 'USB (cable)',
  UI_CONNECT_ROW_WIFI: 'WiFi',
  UI_CONNECT_USB_YES: 'Available',
  UI_CONNECT_USB_NO: 'Not available',
  UI_CONNECT_WIFI_COMING: 'Coming soon',
  UI_CONNECT_USB_BUTTON: 'Connect over USB',
  UI_CONNECT_ANY_PORT_HINT: 'Is your board missing from the list?',
  UI_CONNECT_ANY_PORT_BUTTON: 'Show all ports',
  UI_CONNECT_REMEMBERED: 'Boards you used before',
  UI_CONNECT_RECONNECT: 'Reconnect',
  UI_CONNECT_CONNECTED_TO: 'Connected to',
  UI_CONNECT_UNKNOWN_PORT: 'serial port',
  UI_CONNECT_DISCONNECT: 'Disconnect',
  UI_SUPPORT_REASON_IOS:
    'On iPhone and iPad no browser can use USB. Soon you will be able to upload over WiFi.',
  UI_SUPPORT_REASON_ANDROID:
    'On Android the browser cannot use USB. Soon you will be able to upload over WiFi.',
  UI_SUPPORT_REASON_FIREFOX: 'Firefox cannot use USB. Open the editor in Chrome or Edge.',
  UI_SUPPORT_REASON_SAFARI: 'Safari cannot use USB. Open the editor in Chrome or Edge.',
  UI_SUPPORT_REASON_NO_SERIAL:
    'This browser does not allow USB here. Open the editor in an up-to-date Chrome or Edge, on a computer.',
  UI_CONNECT_ERROR_UNSUPPORTED: 'This browser cannot use USB.',
  UI_CONNECT_ERROR_CANCELLED:
    'You did not pick a port. If your board is missing, try “Show all ports”.',
  UI_CONNECT_ERROR_BLOCKED:
    'The browser blocked USB access. Check the site permissions and try again.',
  UI_CONNECT_ERROR_OPEN_FAILED:
    'The port could not be opened. Close other tabs or the Arduino IDE if they are using it, and try again.',
  UI_CONNECT_ERROR_DISCONNECTED: 'The board was disconnected. Check the cable and connect again.',
  UI_CONNECT_ERROR_UNKNOWN:
    'Something went wrong while connecting. Unplug the cable and try again.',
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
