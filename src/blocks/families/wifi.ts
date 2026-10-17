import * as Blockly from 'blockly/core';
import type { Chip } from '../../boards/types';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import { compileError, cppString, stringInput } from '../cpp-types';
import { currentChip } from '../pins';
import type { BlockFamily } from '../types';

// `wifi` family (ESP32 only): join a network, read the IP and signal, simple HTTP GET / POST.
// Generated code uses the esp32 core 3.3.x `WiFi.h` and `HTTPClient.h` only.
//
// Pattern: espressif/arduino-esp32 — libraries/WiFi/src/WiFiMulti.cpp (`WiFi.begin(ssid, pass)`
// then a `millis() - start <= timeout` loop polling `WiFi.status()` until `WL_CONNECTED`) and
// libraries/ESP_HostedOTA/src/ESP_HostedOTA.cpp (`NetworkClientSecure` + `setInsecure()`, then
// `HTTPClient::begin(client, url)`, `GET()`, `getString()`, `end()`). The HTTPClient signatures
// are libraries/HTTPClient/src/HTTPClient.h. carlosperate/ardublockly and BlocklyDuino have no
// WiFi blocks. Written from scratch; nothing copied.
//
// Decisions (classroom trade-offs, also stated in the tooltips):
// - Connecting blocks the program while it waits, so `somWifiConnect` waits at most
//   CONNECT_TIMEOUT_MS (15 s) and returns at once when already connected: the block can sit
//   inside loop() without re-joining every pass. While waiting it prints dots to Serial, but
//   only when the program uses the serial port (any `som_serial_*` block), so a sketch without
//   serial never touches it.
// - HTTPS skips certificate checks (`WiFiClientSecure::setInsecure()`): pinning a CA per site
//   is beyond ages 10–14 and certificates expire under a deployed class. Traffic is encrypted
//   but the server is not authenticated, so never send secrets this way.
// - HTTP helpers return the response body, or "" on any failure (no WiFi, bad URL, timeout,
//   status other than 2xx). "" is the error signal; an empty 2xx body looks the same.
//   Connect and response timeouts are 5 s each, so a request can't freeze the board forever.
// - Boards without WiFi (AVR) never get WiFi code: each block emits an `ERROR` comment and the
//   sketch gets one translated `#error`, so the compile fails loudly (B3's lists precedent).

const COLOUR = '#3a7bd5';
export const CONNECT_TIMEOUT_MS = 15000;
const HTTP_TIMEOUT_MS = 5000;
const CONTENT_TYPES = ['text/plain', 'application/json'];
const TOOLTIP_EXTENSION = 'som_wifi_tooltip';

const WIFI_CHIPS: readonly Chip[] = ['esp32', 'esp32c3'];

/** True when the selected board's chip runs the esp32 core's WiFi.h / HTTPClient.h. */
export function hasEsp32Wifi(chip: Chip = currentChip()): boolean {
  return WIFI_CHIPS.includes(chip);
}

function needsEsp32Message(): string {
  return Blockly.Msg['SOM_WIFI_NEEDS_ESP32'] ?? '';
}

/**
 * On a board without esp32 WiFi, flag the sketch with one `#error` and return the comment the
 * block emits instead of WiFi code; `null` when the board has WiFi.
 */
function boardError(generator: ArduinoGenerator): string | null {
  if (hasEsp32Wifi()) return null;
  const message = needsEsp32Message();
  compileError(generator, 'wifi', message);
  return `ERROR: ${message}`;
}

/** The program prints to the serial port (so Serial.begin is in setup). */
function usesSerial(workspace: Blockly.Workspace): boolean {
  return workspace
    .getAllBlocks(false)
    .some(
      (b) =>
        b.type.startsWith('som_serial_') &&
        b.isEnabled() &&
        !b.getInheritedDisabled() &&
        !b.isInsertionMarker(),
    );
}

function connectHelper(dots: boolean): string {
  const dot = dots ? ['    Serial.print(".");'] : [];
  const newline = dots ? ['  Serial.println();'] : [];
  return [
    '// Joins a WiFi network, waiting at most timeoutMs. Already connected: returns at once.',
    'bool somWifiConnect(const char *ssid, const char *pass, unsigned long timeoutMs) {',
    '  if (WiFi.status() == WL_CONNECTED) return true;',
    '  WiFi.begin(ssid, pass);',
    '  unsigned long start = millis();',
    '  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {',
    '    delay(250);',
    ...dot,
    '  }',
    ...newline,
    '  return WiFi.status() == WL_CONNECTED;',
    '}',
  ].join('\n');
}

const HTTP_REQUEST_HELPER = [
  '// HTTP(S) request: the response body, or "" on any error (no WiFi, timeout, not 2xx).',
  '// https:// does not check the certificate (setInsecure): encrypted, not authenticated.',
  'String somHttpRequest(const String &url, const char *contentType, const String &body, bool post) {',
  '  if (WiFi.status() != WL_CONNECTED) return "";',
  '  WiFiClient plain;',
  '  WiFiClientSecure secure;',
  '  secure.setInsecure();',
  '  WiFiClient &client = url.startsWith("https://") ? secure : plain;',
  '  HTTPClient http;',
  `  http.setConnectTimeout(${HTTP_TIMEOUT_MS});`,
  `  http.setTimeout(${HTTP_TIMEOUT_MS});`,
  '  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);',
  '  if (!http.begin(client, url)) return "";',
  '  int code;',
  '  if (post) {',
  '    http.addHeader("Content-Type", contentType);',
  '    code = http.POST(body);',
  '  } else {',
  '    code = http.GET();',
  '  }',
  '  String result = (code >= 200 && code < 300) ? http.getString() : String("");',
  '  http.end();',
  '  return result;',
  '}',
].join('\n');

const HTTP_GET_HELPER = [
  'String somHttpGet(const String &url) {',
  '  return somHttpRequest(url, "", "", false);',
  '}',
].join('\n');

const HTTP_POST_HELPER = [
  'String somHttpPost(const String &url, const String &body, const char *contentType) {',
  '  return somHttpRequest(url, contentType, body, true);',
  '}',
].join('\n');

/** Includes plus the shared request helper, then the GET or POST wrapper the block calls. */
function addHttp(generator: ArduinoGenerator, key: string, helper: string): void {
  generator.addInclude('WiFi.h');
  generator.addInclude('HTTPClient.h');
  generator.addInclude('WiFiClientSecure.h');
  generator.addDefinition('wifi_http_request', HTTP_REQUEST_HELPER);
  generator.addDefinition(key, helper);
}

/** Tooltip message key per block (literal keys, so `pnpm i18n:check` sees them used). */
const TOOLTIP_KEYS: Record<string, string> = {
  som_wifi_connect: 'SOM_WIFI_CONNECT_TOOLTIP',
  som_wifi_connected: 'SOM_WIFI_CONNECTED_TOOLTIP',
  som_wifi_ip: 'SOM_WIFI_IP_TOOLTIP',
  som_wifi_signal: 'SOM_WIFI_SIGNAL_TOOLTIP',
  som_wifi_http_get: 'SOM_WIFI_HTTP_GET_TOOLTIP',
  som_wifi_http_post: 'SOM_WIFI_HTTP_POST_TOOLTIP',
  som_wifi_disconnect: 'SOM_WIFI_DISCONNECT_TOOLTIP',
};

/**
 * Tooltip: the block's own text, prefixed with "ESP32 only" while another board is selected.
 * Read on hover, so it follows the board picker and the language without re-creating blocks.
 */
function tooltipExtension(this: Blockly.Block): void {
  const key = TOOLTIP_KEYS[this.type] ?? '';
  this.setTooltip(() => {
    const text = Blockly.Msg[key] ?? '';
    return hasEsp32Wifi() ? text : `${Blockly.Msg['SOM_WIFI_ONLY_ESP32'] ?? ''} ${text}`;
  });
}

const statement = { previousStatement: null, nextStatement: null, colour: COLOUR };
const ext = { extensions: [TOOLTIP_EXTENSION] };

export const wifiFamily: BlockFamily = {
  id: 'wifi',
  blocks: [
    {
      type: 'som_wifi_connect',
      message0: '%{BKY_SOM_WIFI_CONNECT}',
      args0: [
        { type: 'field_input', name: 'SSID', text: '%{BKY_SOM_WIFI_SSID_DEFAULT}' },
        { type: 'field_input', name: 'PASSWORD', text: '%{BKY_SOM_WIFI_PASSWORD_DEFAULT}' },
      ],
      ...statement,
      ...ext,
    },
    {
      type: 'som_wifi_connected',
      message0: '%{BKY_SOM_WIFI_CONNECTED}',
      output: 'Boolean',
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_wifi_ip',
      message0: '%{BKY_SOM_WIFI_IP}',
      output: 'String',
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_wifi_signal',
      message0: '%{BKY_SOM_WIFI_SIGNAL}',
      output: 'Number',
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_wifi_http_get',
      message0: '%{BKY_SOM_WIFI_HTTP_GET}',
      args0: [{ type: 'input_value', name: 'URL', check: 'String' }],
      output: 'String',
      inputsInline: true,
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_wifi_http_post',
      message0: '%{BKY_SOM_WIFI_HTTP_POST}',
      args0: [
        { type: 'input_value', name: 'BODY', check: 'String' },
        { type: 'input_value', name: 'URL', check: 'String' },
        {
          type: 'field_dropdown',
          name: 'TYPE',
          options: CONTENT_TYPES.map((type) => [type, type]),
        },
      ],
      output: 'String',
      inputsInline: true,
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_wifi_disconnect',
      message0: '%{BKY_SOM_WIFI_DISCONNECT}',
      ...statement,
      ...ext,
    },
  ],
  extensions: { [TOOLTIP_EXTENSION]: tooltipExtension },
  generators: {
    som_wifi_connect: (block, generator) => {
      const error = boardError(generator);
      if (error) return `// ${error}\n`;
      generator.addInclude('WiFi.h');
      generator.addSetup('wifi_mode', 'WiFi.mode(WIFI_STA);');
      generator.addDefinition('wifi_connect', connectHelper(usesSerial(block.workspace)));
      const ssid = cppString(String(block.getFieldValue('SSID') ?? ''));
      const pass = cppString(String(block.getFieldValue('PASSWORD') ?? ''));
      return `somWifiConnect(${ssid}, ${pass}, ${CONNECT_TIMEOUT_MS});\n`;
    },
    som_wifi_connected: (_block, generator) => {
      const error = boardError(generator);
      if (error) return [`/* ${error} */ false`, Order.ATOMIC];
      generator.addInclude('WiFi.h');
      return ['WiFi.status() == WL_CONNECTED', Order.EQUALITY];
    },
    som_wifi_ip: (_block, generator) => {
      const error = boardError(generator);
      if (error) return [`/* ${error} */ String("")`, Order.ATOMIC];
      generator.addInclude('WiFi.h');
      return ['WiFi.localIP().toString()', Order.POSTFIX];
    },
    som_wifi_signal: (_block, generator) => {
      const error = boardError(generator);
      if (error) return [`/* ${error} */ 0`, Order.ATOMIC];
      generator.addInclude('WiFi.h');
      return ['WiFi.RSSI()', Order.POSTFIX];
    },
    som_wifi_http_get: (block, generator) => {
      const error = boardError(generator);
      if (error) return [`/* ${error} */ String("")`, Order.ATOMIC];
      addHttp(generator, 'wifi_http_get', HTTP_GET_HELPER);
      const url = stringInput(block, generator, 'URL', Order.COMMA) ?? '""';
      return [`somHttpGet(${url})`, Order.POSTFIX];
    },
    som_wifi_http_post: (block, generator) => {
      const error = boardError(generator);
      if (error) return [`/* ${error} */ String("")`, Order.ATOMIC];
      addHttp(generator, 'wifi_http_post', HTTP_POST_HELPER);
      const url = stringInput(block, generator, 'URL', Order.COMMA) ?? '""';
      const body = stringInput(block, generator, 'BODY', Order.COMMA) ?? '""';
      const picked = String(block.getFieldValue('TYPE'));
      const type = CONTENT_TYPES.includes(picked) ? picked : 'text/plain';
      return [`somHttpPost(${url}, ${body}, ${cppString(type)})`, Order.POSTFIX];
    },
    som_wifi_disconnect: (_block, generator) => {
      const error = boardError(generator);
      if (error) return `// ${error}\n`;
      generator.addInclude('WiFi.h');
      return 'WiFi.disconnect();\n';
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_WIFI_CATEGORY}',
    colour: COLOUR,
    contents: [
      { kind: 'block', type: 'som_wifi_connect' },
      { kind: 'block', type: 'som_wifi_connected' },
      { kind: 'block', type: 'som_wifi_ip' },
      { kind: 'block', type: 'som_wifi_signal' },
      {
        kind: 'block',
        type: 'som_wifi_http_get',
        inputs: { URL: { shadow: { type: 'text', fields: { TEXT: 'http://example.com' } } } },
      },
      {
        kind: 'block',
        type: 'som_wifi_http_post',
        inputs: {
          BODY: { shadow: { type: 'text', fields: { TEXT: 'hola' } } },
          URL: { shadow: { type: 'text', fields: { TEXT: 'http://example.com' } } },
        },
      },
      { kind: 'block', type: 'som_wifi_disconnect' },
    ],
  },
  messages: {
    es: {
      SOM_WIFI_CATEGORY: 'WiFi',
      SOM_WIFI_ONLY_ESP32: 'Solo ESP32.',
      SOM_WIFI_NEEDS_ESP32:
        'Los bloques WiFi solo funcionan en una placa ESP32. Elige la ESP32-C3 en "Placa".',
      SOM_WIFI_CONNECT: 'conectar a WiFi %1 contraseña %2',
      SOM_WIFI_SSID_DEFAULT: 'mi-red',
      SOM_WIFI_PASSWORD_DEFAULT: 'contraseña',
      SOM_WIFI_CONNECT_TOOLTIP:
        'Conecta la placa a una red WiFi. Espera hasta 15 segundos; mientras, el programa se detiene. Si ya está conectada, sigue de inmediato.',
      SOM_WIFI_CONNECTED: 'WiFi conectado',
      SOM_WIFI_CONNECTED_TOOLTIP: 'Verdadero si la placa está conectada a la red WiFi.',
      SOM_WIFI_IP: 'mi dirección IP',
      SOM_WIFI_IP_TOOLTIP: 'La dirección de la placa en la red, como 192.168.1.20.',
      SOM_WIFI_SIGNAL: 'fuerza de la señal WiFi',
      SOM_WIFI_SIGNAL_TOOLTIP:
        'Qué tan fuerte llega la red: -30 es muy cerca, -90 es muy lejos. Da 0 si no está conectada.',
      SOM_WIFI_HTTP_GET: 'pedir a la web %1',
      SOM_WIFI_HTTP_GET_TOOLTIP:
        'Pide una página y entrega su texto. Si falla, entrega texto vacío. Con https no se revisa el certificado: no envíes datos secretos.',
      SOM_WIFI_HTTP_POST: 'enviar %1 a la web %2 como %3',
      SOM_WIFI_HTTP_POST_TOOLTIP:
        'Envía un texto a una página y entrega su respuesta. Si falla, entrega texto vacío. Con https no se revisa el certificado: no envíes datos secretos.',
      SOM_WIFI_DISCONNECT: 'desconectar WiFi',
      SOM_WIFI_DISCONNECT_TOOLTIP: 'Desconecta la placa de la red WiFi.',
    },
    en: {
      SOM_WIFI_CATEGORY: 'WiFi',
      SOM_WIFI_ONLY_ESP32: 'ESP32 only.',
      SOM_WIFI_NEEDS_ESP32:
        'WiFi blocks only work on an ESP32 board. Pick the ESP32-C3 in "Board".',
      SOM_WIFI_CONNECT: 'connect to WiFi %1 password %2',
      SOM_WIFI_SSID_DEFAULT: 'my-network',
      SOM_WIFI_PASSWORD_DEFAULT: 'password',
      SOM_WIFI_CONNECT_TOOLTIP:
        'Connects the board to a WiFi network. Waits up to 15 seconds; the program pauses meanwhile. If already connected, it goes on right away.',
      SOM_WIFI_CONNECTED: 'WiFi connected',
      SOM_WIFI_CONNECTED_TOOLTIP: 'True when the board is connected to the WiFi network.',
      SOM_WIFI_IP: 'my IP address',
      SOM_WIFI_IP_TOOLTIP: "The board's address on the network, like 192.168.1.20.",
      SOM_WIFI_SIGNAL: 'WiFi signal strength',
      SOM_WIFI_SIGNAL_TOOLTIP:
        'How strong the network is: -30 is very close, -90 is very far. Gives 0 when not connected.',
      SOM_WIFI_HTTP_GET: 'get from the web %1',
      SOM_WIFI_HTTP_GET_TOOLTIP:
        'Asks for a page and gives back its text. If it fails, you get empty text. With https the certificate is not checked: never send secrets.',
      SOM_WIFI_HTTP_POST: 'send %1 to the web %2 as %3',
      SOM_WIFI_HTTP_POST_TOOLTIP:
        'Sends text to a page and gives back its answer. If it fails, you get empty text. With https the certificate is not checked: never send secrets.',
      SOM_WIFI_DISCONNECT: 'disconnect WiFi',
      SOM_WIFI_DISCONNECT_TOOLTIP: 'Disconnects the board from the WiFi network.',
    },
  },
};
