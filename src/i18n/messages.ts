// UI message layer (_config/i18n.md). Flat `UI_*` keys, one dictionary per language in
// SUPPORTED_LANGS; `es` is the source language and the fallback. Block labels live in each
// block family's `messages`. `pnpm i18n:check` (scripts/check-i18n.ts) fails CI when the
// dictionaries' key sets differ or a key is unused.

const es = {
  UI_APP_TITLE: 'SoM Blocks',
  UI_TAGLINE: 'Programa tu placa con bloques',
  UI_WORKSPACE_LABEL: 'Espacio de bloques',
  UI_GENERATED_CODE: 'Código generado',
  UI_CODE_SHOW: 'Ver código',
  UI_CODE_HIDE: 'Ocultar código',
  UI_CODE_COPY: 'Copiar',
  UI_CODE_COPIED: 'Copiado',
  UI_CODE_COPY_HINT: 'Copia el código para pegarlo en el Arduino IDE',
  UI_CODE_COPY_FAILED: 'No se pudo copiar. Selecciona el código y cópialo con Ctrl+C.',
  UI_CODE_DOWNLOAD: 'Descargar .ino',
  UI_CODE_DOWNLOAD_HINT: 'Guarda el código como archivo .ino para abrirlo en el Arduino IDE',
  UI_CODE_TOO_LONG_TO_COLOR: 'Tu programa es muy largo, así que lo mostramos sin colores.',
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
  UI_PROJECTS: 'Proyectos',
  UI_PROJECT_NAME: 'Nombre del proyecto',
  UI_PROJECT_DEFAULT_NAME: 'Mi proyecto',
  UI_PROJECT_NEW: 'Nuevo proyecto',
  UI_PROJECT_DUPLICATE: 'Duplicar',
  UI_PROJECT_EXPORT: 'Exportar (.zip)',
  UI_PROJECT_IMPORT: 'Importar…',
  UI_PROJECT_DELETE: 'Borrar',
  UI_PROJECT_DELETE_CONFIRM: '¿Borrar «{name}»? No se puede deshacer.',
  UI_PROJECT_RECENT: 'Recientes',
  UI_PROJECT_UPDATED: 'editado {when}',
  UI_PROJECT_MEMORY_ONLY:
    'Este navegador no deja guardar proyectos. Si cierras la pestaña, se pierde tu trabajo: expórtalo.',
  UI_PROJECT_CORRUPT:
    'No se pudo abrir «{name}». Empezamos un proyecto nuevo; el original sigue guardado.',
  UI_PROJECT_UNKNOWN_BOARD:
    '«{name}» usaba una placa que no conocemos ({board}). Lo abrimos con la placa {fallback}.',
  UI_PROJECT_IMPORT_TOO_BIG: 'El archivo es muy grande (máximo 5 MB).',
  UI_PROJECT_IMPORT_UNREADABLE: 'No se pudo leer ese archivo.',
  UI_PROJECT_IMPORT_NOT_PROJECT: 'Ese archivo no es un proyecto de SoM Blocks.',
  UI_PROJECT_SAVE_FAILED: 'No se pudo guardar. Exporta tu proyecto para no perderlo.',
  UI_PROJECT_EXPORT_FAILED: 'No se pudo exportar el proyecto.',
  UI_DISMISS: 'Cerrar',
  UI_SERIAL_PANEL: 'Monitor serie',
  UI_SERIAL_TAB_MONITOR: 'Monitor',
  UI_SERIAL_TAB_PLOT: 'Gráfico',
  UI_SERIAL_SHOW: 'Mostrar',
  UI_SERIAL_HIDE: 'Ocultar',
  UI_SERIAL_LOADING: 'Cargando…',
  UI_SERIAL_LOAD_FAILED: 'No se pudo cargar esta parte. Revisa tu internet y recarga la página.',
  UI_SERIAL_RELOAD: 'Recargar',
  UI_SERIAL_BAUD: 'Velocidad (baudios)',
  UI_SERIAL_LINE_ENDING: 'Fin de línea',
  UI_SERIAL_ENDING_NONE: 'Nada',
  UI_SERIAL_ENDING_LF: 'Salto de línea',
  UI_SERIAL_ENDING_CRLF: 'Retorno y salto',
  UI_SERIAL_INPUT: 'Mensaje para la placa',
  UI_SERIAL_SEND: 'Enviar',
  UI_SERIAL_PAUSE: 'Pausar',
  UI_SERIAL_RESUME: 'Seguir',
  UI_SERIAL_CLEAR: 'Borrar',
  UI_SERIAL_AUTOSCROLL: 'Bajar solo',
  UI_SERIAL_DOWNLOAD: 'Descargar .txt',
  UI_SERIAL_TERMINAL: 'Lo que escribe la placa',
  UI_SERIAL_CONNECT_FIRST:
    'Conecta tu placa primero con el botón Conectar, arriba, para ver lo que escribe.',
  UI_SERIAL_DISCONNECTED: 'Se desconectó la placa. Lo que llegó antes sigue aquí.',
  UI_SERIAL_MUTED: 'Subiendo el programa… el monitor vuelve cuando termine.',
  UI_SERIAL_PAUSED: 'En pausa: lo que llega se sigue guardando.',
  UI_SERIAL_ERROR_NOT_CONNECTED: 'No hay ninguna placa conectada.',
  UI_SERIAL_ERROR_SEND: 'No se pudo enviar el mensaje.',
  UI_PLOT_EMPTY: 'Aún no hay números. Usa el bloque «graficar» para enviar nombre:valor.',
  UI_PLOT_CHART: 'Gráfico de los valores que envía la placa',
  UI_LANGUAGE: 'Idioma',
  UI_UPLOAD: 'Subir',
  UI_UPLOADING: 'Subiendo…',
  UI_UPLOAD_CANCEL: 'Cancelar',
  UI_UPLOAD_REASON_COMPILE: 'Primero pulsa Compilar.',
  UI_UPLOAD_REASON_CONNECT: 'Conecta tu placa con el botón Conectar.',
  UI_UPLOAD_PHASE_COMPILE: 'Compilando antes de subir…',
  UI_UPLOAD_PHASE_CONNECT: 'Conectando con la placa…',
  UI_UPLOAD_PHASE_ERASE: 'Borrando la placa…',
  UI_UPLOAD_PHASE_WRITE: 'Escribiendo tu programa… {percent} %',
  UI_UPLOAD_PHASE_VERIFY: 'Revisando que quedó bien…',
  UI_UPLOAD_PHASE_RESET: 'Reiniciando la placa…',
  UI_UPLOAD_PHASE_DONE: '¡Listo! Tu programa ya está en la placa.',
  UI_UPLOAD_ERR_COMPILE: 'Tu programa no compiló. Lee la salida del compilador.',
  UI_UPLOAD_ERR_NO_PORT: 'Conecta tu placa con el botón Conectar y vuelve a pulsar Subir.',
  UI_UPLOAD_ERR_WRONG_CHIP:
    'La placa conectada no es la que elegiste. Revisa la placa en el menú «Placa».',
  UI_UPLOAD_ERR_SYNC_ESP:
    'La placa no respondió. Revisa que elegiste la placa correcta. Si lo es, mantén apretado BOOT, aprieta y suelta RESET, suelta BOOT y vuelve a pulsar Subir.',
  UI_UPLOAD_ERR_SYNC_AVR:
    'La placa no respondió. Revisa que elegiste la placa correcta en el menú «Placa» y vuelve a intentar.',
  UI_UPLOAD_ERR_WRITE: 'Se cortó la subida. Revisa el cable y vuelve a intentar.',
  UI_UPLOAD_ERR_VERIFY: 'El programa no quedó bien grabado. Vuelve a pulsar Subir.',
  UI_UPLOAD_ERR_CANCELLED:
    'Cancelaste la subida. La placa puede quedar sin programa hasta que subas uno.',
  UI_UPLOAD_ERR_UNSUPPORTED: 'Esta placa todavía no se puede programar desde aquí.',
  UI_UPLOAD_ERR_TRANSPORT:
    'Se perdió la conexión con la placa. Revisa el cable y vuelve a conectar.',
} as const;

export type MessageKey = keyof typeof es;

// Partial so a missing translation is a fallback to `es`, not a type error.
const en: Partial<Record<MessageKey, string>> = {
  UI_APP_TITLE: 'SoM Blocks',
  UI_TAGLINE: 'Program your board with blocks',
  UI_WORKSPACE_LABEL: 'Blocks workspace',
  UI_GENERATED_CODE: 'Generated code',
  UI_CODE_SHOW: 'Show code',
  UI_CODE_HIDE: 'Hide code',
  UI_CODE_COPY: 'Copy',
  UI_CODE_COPIED: 'Copied',
  UI_CODE_COPY_HINT: 'Copy the code to paste it into the Arduino IDE',
  UI_CODE_COPY_FAILED: 'Could not copy. Select the code and copy it with Ctrl+C.',
  UI_CODE_DOWNLOAD: 'Download .ino',
  UI_CODE_DOWNLOAD_HINT: 'Save the code as an .ino file to open it in the Arduino IDE',
  UI_CODE_TOO_LONG_TO_COLOR: 'Your program is very long, so we show it without colours.',
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
  UI_PROJECTS: 'Projects',
  UI_PROJECT_NAME: 'Project name',
  UI_PROJECT_DEFAULT_NAME: 'My project',
  UI_PROJECT_NEW: 'New project',
  UI_PROJECT_DUPLICATE: 'Duplicate',
  UI_PROJECT_EXPORT: 'Export (.zip)',
  UI_PROJECT_IMPORT: 'Import…',
  UI_PROJECT_DELETE: 'Delete',
  UI_PROJECT_DELETE_CONFIRM: 'Delete “{name}”? This cannot be undone.',
  UI_PROJECT_RECENT: 'Recent',
  UI_PROJECT_UPDATED: 'edited {when}',
  UI_PROJECT_MEMORY_ONLY:
    "This browser won't let us save projects. If you close the tab your work is lost, so export it.",
  UI_PROJECT_CORRUPT:
    'Could not open “{name}”. We started a new project; the original is still saved.',
  UI_PROJECT_UNKNOWN_BOARD:
    '“{name}” used a board we don’t know ({board}). We opened it with the {fallback}.',
  UI_PROJECT_IMPORT_TOO_BIG: 'That file is too big (5 MB max).',
  UI_PROJECT_IMPORT_UNREADABLE: 'Could not read that file.',
  UI_PROJECT_IMPORT_NOT_PROJECT: "That file isn't a SoM Blocks project.",
  UI_PROJECT_SAVE_FAILED: 'Could not save. Export your project so you do not lose it.',
  UI_PROJECT_EXPORT_FAILED: 'Could not export the project.',
  UI_DISMISS: 'Close',
  UI_SERIAL_PANEL: 'Serial monitor',
  UI_SERIAL_TAB_MONITOR: 'Monitor',
  UI_SERIAL_TAB_PLOT: 'Plot',
  UI_SERIAL_SHOW: 'Show',
  UI_SERIAL_HIDE: 'Hide',
  UI_SERIAL_LOADING: 'Loading…',
  UI_SERIAL_LOAD_FAILED: 'This part could not load. Check your internet and reload the page.',
  UI_SERIAL_RELOAD: 'Reload',
  UI_SERIAL_BAUD: 'Speed (baud)',
  UI_SERIAL_LINE_ENDING: 'Line ending',
  UI_SERIAL_ENDING_NONE: 'None',
  UI_SERIAL_ENDING_LF: 'New line',
  UI_SERIAL_ENDING_CRLF: 'Return and new line',
  UI_SERIAL_INPUT: 'Message for the board',
  UI_SERIAL_SEND: 'Send',
  UI_SERIAL_PAUSE: 'Pause',
  UI_SERIAL_RESUME: 'Resume',
  UI_SERIAL_CLEAR: 'Clear',
  UI_SERIAL_AUTOSCROLL: 'Auto-scroll',
  UI_SERIAL_DOWNLOAD: 'Download .txt',
  UI_SERIAL_TERMINAL: 'What the board prints',
  UI_SERIAL_CONNECT_FIRST:
    'Connect your board first with the Connect button at the top to see what it prints.',
  UI_SERIAL_DISCONNECTED: 'The board was disconnected. What arrived before is still here.',
  UI_SERIAL_MUTED: 'Uploading your program… the monitor comes back when it is done.',
  UI_SERIAL_PAUSED: 'Paused: incoming text is still being saved.',
  UI_SERIAL_ERROR_NOT_CONNECTED: 'No board is connected.',
  UI_SERIAL_ERROR_SEND: 'The message could not be sent.',
  UI_PLOT_EMPTY: 'No numbers yet. Use the “plot” block to send name:value.',
  UI_PLOT_CHART: 'Chart of the values the board sends',
  UI_LANGUAGE: 'Language',
  UI_UPLOAD: 'Upload',
  UI_UPLOADING: 'Uploading…',
  UI_UPLOAD_CANCEL: 'Cancel',
  UI_UPLOAD_REASON_COMPILE: 'Press Compile first.',
  UI_UPLOAD_REASON_CONNECT: 'Connect your board with the Connect button.',
  UI_UPLOAD_PHASE_COMPILE: 'Compiling before the upload…',
  UI_UPLOAD_PHASE_CONNECT: 'Talking to the board…',
  UI_UPLOAD_PHASE_ERASE: 'Erasing the board…',
  UI_UPLOAD_PHASE_WRITE: 'Writing your program… {percent} %',
  UI_UPLOAD_PHASE_VERIFY: 'Checking it was written right…',
  UI_UPLOAD_PHASE_RESET: 'Restarting the board…',
  UI_UPLOAD_PHASE_DONE: 'Done! Your program is on the board.',
  UI_UPLOAD_ERR_COMPILE: 'Your program did not compile. Read the compiler output.',
  UI_UPLOAD_ERR_NO_PORT: 'Connect your board with the Connect button and press Upload again.',
  UI_UPLOAD_ERR_WRONG_CHIP:
    'The connected board is not the one you picked. Check the board in the “Board” menu.',
  UI_UPLOAD_ERR_SYNC_ESP:
    'The board did not answer. Check you picked the right board. If you did, hold BOOT, press and release RESET, let go of BOOT and press Upload again.',
  UI_UPLOAD_ERR_SYNC_AVR:
    'The board did not answer. Check you picked the right board in the “Board” menu and try again.',
  UI_UPLOAD_ERR_WRITE: 'The upload broke off. Check the cable and try again.',
  UI_UPLOAD_ERR_VERIFY: 'The program was not written correctly. Press Upload again.',
  UI_UPLOAD_ERR_CANCELLED:
    'You cancelled the upload. The board may have no program until you upload one.',
  UI_UPLOAD_ERR_UNSUPPORTED: 'This board cannot be programmed from here yet.',
  UI_UPLOAD_ERR_TRANSPORT:
    'The connection to the board was lost. Check the cable and connect again.',
};

/**
 * Every language the editor ships. `Lang`, the UI dictionaries below, the language switch and
 * Blockly's core message map (src/blocks/registry.ts) are all keyed from this one array:
 * adding a language is one entry here plus its dictionaries (_config/i18n.md → checklist).
 */
export const SUPPORTED_LANGS = ['es', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';

/** UI dictionaries per language; a key missing from one falls back to `es` in {@link t}. */
export const UI_MESSAGES: Record<Lang, Partial<Record<MessageKey, string>>> = { es, en };

const warnedMissing = new Set<string>();

/**
 * Dev-only, once per (scope, language, key): a translation is missing and `es` is shown
 * instead. Production stays quiet; `pnpm i18n:check` is what blocks the merge.
 */
export function warnMissingTranslation(scope: string, lang: Lang, key: string): void {
  // `import.meta.env` is Vite's; it is absent when scripts load this module under plain Node.
  if (!import.meta.env?.DEV) return;
  const id = `${scope}:${lang}:${key}`;
  if (warnedMissing.has(id)) return;
  warnedMissing.add(id);
  console.warn(`[i18n] ${scope} key "${key}" has no "${lang}" translation; showing "es".`);
}

// Pattern: microsoft/pxt pxtlib/commonutil.ts `_localize` returns the source string when a
// translation is missing (`_localizeStrings[s] || s`). Difference: our keys are ids, not the
// source text, so the fallback is the `es` dictionary, and dev builds name the key that fell
// back.
export function t(key: MessageKey, lang: Lang = DEFAULT_LANG): string {
  const translated = UI_MESSAGES[lang][key];
  if (translated !== undefined) return translated;
  if (lang !== DEFAULT_LANG) warnMissingTranslation('UI', lang, key);
  return es[key];
}

/** Fills `{name}` placeholders in a message. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
