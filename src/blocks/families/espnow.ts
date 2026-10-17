import * as Blockly from 'blockly/core';
import type { Chip } from '../../boards/types';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import { compileError, cppString, stringInput } from '../cpp-types';
import { currentChip } from '../pins';
import type { BlockFamily } from '../types';
import { truncateUtf8 } from './ble';

// `espnow` family (ESP32 only): boards talk to each other by name, without a router.
// Model (_config/architecture.md → ESP-NOW model, decision 2026-10-16): every board names
// itself; `send <value> to <name>` and `send <value> to everyone` both go to the broadcast
// MAC FF:FF:FF:FF:FF:FF on channel 1, unencrypted, with `{from, to, value}` in the payload.
// `when a message arrives from <name | anyone>` filters on `to ∈ {me, everyone}` and `from`.
// No MAC addresses anywhere in the student UI.
//
// Pattern: espressif/arduino-esp32 libraries/ESP_NOW/src/ESP32_NOW.cpp (core 3.3.x) —
// `esp_now_init()`, a zeroed `esp_now_peer_info_t` with the peer MAC, channel, `ifidx` and
// `encrypt = false` passed to `esp_now_add_peer`, the 3.x receive callback
// `(const esp_now_recv_info_t *info, const uint8_t *data, int len)`, and the send callback
// whose signature changed in ESP-IDF 5.5 (`const esp_now_send_info_t *` instead of the MAC),
// guarded by `ESP_IDF_VERSION` exactly like the wrapper does. Channel via `esp_wifi_set_channel`
// (libraries/WiFi/src/WiFiGeneric.cpp). Kid-facing wording after MakeCode's radio blocks
// ("send string", "on received"). Written from scratch; nothing copied.
//
// Decisions:
// - Raw `esp_now.h` C API, not the 3.x `ESP_NOW` C++ wrapper: the wrapper routes received data
//   to `ESP_NOW_Peer` subclasses keyed by MAC (unknown senders go to `onNewPeer`), which is the
//   opposite of our name-over-broadcast model and needs a class per sketch. The raw API is a
//   handful of calls, matches most tutorials, and keeps the generated code readable.
// - Payload is a fixed struct `{ char from[16]; char to[16]; char value[200]; }` (232 bytes),
//   not a JSON string: no parsing library, a deterministic size, and a received packet of any
//   other length is simply ignored (another program on the channel). `static_assert` keeps it
//   under ESP-NOW's 250-byte limit. Names hold 15 bytes, values 199 (tooltips say so). Names
//   typed in blocks are cut to 15 UTF-8 bytes when the code is generated (like BLE's 29-byte
//   cap), so the code shows the name that really travels; runtime strings (a variable, `who
//   sent it`) are cut by `strncpy` at 15 / 199 bytes, always null-terminated.
// - The receive callback runs in the WiFi task, never in loop(): it copies the packet into a
//   ring queue of 8 under a mutex (BLE's counter-under-mutex pattern) and returns. Messages
//   not addressed to this board's name or to everyone ("*") are dropped right there. Student
//   blocks never run in the callback.
// - Each `when a message arrives` block keeps its own read position (a `static` from the
//   name DB, like `som_time_every`), so two hats each see every message. A hat that falls
//   more than 8 messages behind skips the oldest ones; `somEspNowDropped` counts them (not
//   shown to students in v1, documented only).
// - Broadcast has no acknowledgement: `send` returns before anyone receives, and the send
//   callback's status is informational only (`somEspNowSendFailed`, not shown in v1).
// - `my name is` is idempotent, so it can sit at the top of loop(): the first call starts
//   ESP-NOW, later calls only update the name. Sends before it do nothing.
// - WiFi coexistence: ESP-NOW is fixed on channel 1. A sketch that also joins a router with
//   the wifi family would have to use the router's channel; v1 does not negotiate it, so the
//   tooltips say not to mix ESP-NOW with the WiFi blocks.
// - Board gating like wifi: esp32 chips only; AVR / ESP8266 get one translated `#error` and
//   an `ERROR` comment at every block, never ESP-NOW code.

const COLOUR = '#0f9d8a';
const TOOLTIP_EXTENSION = 'som_espnow_tooltip';
const FROM_EXTENSION = 'som_espnow_from_toggle';

/** Longest board name in the payload (bytes), not counting the terminating null. */
export const ESPNOW_NAME_MAX_BYTES = 15;
/** Longest value in the payload (bytes), not counting the terminating null. */
export const ESPNOW_VALUE_MAX_BYTES = 199;
/** Name a board gets when its `my name is` field is empty. */
export const ESPNOW_DEFAULT_NAME = 'SoM';

const ESPNOW_CHIPS: readonly Chip[] = ['esp32', 'esp32c3'];

/** True when the selected board's chip runs the esp32 core's `esp_now.h`. */
export function hasEspNow(chip: Chip = currentChip()): boolean {
  return ESPNOW_CHIPS.includes(chip);
}

const HELPERS = `// ESP-NOW: messages by name, sent to everyone (broadcast) on channel 1, unencrypted.
// Packet: who sends it, who it is for ("*" = everyone) and the value, all as text.
struct SomEspNowPacket {
  char from[${ESPNOW_NAME_MAX_BYTES + 1}];
  char to[${ESPNOW_NAME_MAX_BYTES + 1}];
  char value[${ESPNOW_VALUE_MAX_BYTES + 1}];
};
static_assert(sizeof(SomEspNowPacket) <= ESP_NOW_MAX_DATA_LEN, "ESP-NOW sends at most 250 bytes");
const uint8_t SOM_ESPNOW_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
const uint8_t SOM_ESPNOW_CHANNEL = 1;
const uint32_t SOM_ESPNOW_QUEUE_SIZE = 8;  // a power of two, so the index survives wrap-around
SomEspNowPacket somEspNowQueue[SOM_ESPNOW_QUEUE_SIZE];
uint32_t somEspNowWritten = 0;     // packets queued since boot
uint32_t somEspNowDropped = 0;     // skipped by a hat that fell behind (not shown in v1)
uint32_t somEspNowSendFailed = 0;  // informational: broadcast has no acknowledgement
char somEspNowMe[${ESPNOW_NAME_MAX_BYTES + 1}] = "";
std::mutex somEspNowLock;          // guards everything above, shared with the WiFi task
bool somEspNowReady = false;
String somEspNowValue = "";        // the message a "when a message arrives" block is handling
String somEspNowFrom = "";

// Copy text into a fixed field, cut to fit and always null-terminated.
void somEspNowCopy(char *field, size_t size, const char *text) {
  strncpy(field, text, size - 1);
  field[size - 1] = '\\0';
}

// Runs in the WiFi task: keep the packet if it is for me or for everyone, then return.
void somEspNowOnRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != (int)sizeof(SomEspNowPacket)) return;  // not a som-blocks message
  SomEspNowPacket packet;
  memcpy(&packet, data, sizeof(packet));
  packet.from[sizeof(packet.from) - 1] = '\\0';
  packet.to[sizeof(packet.to) - 1] = '\\0';
  packet.value[sizeof(packet.value) - 1] = '\\0';
  std::lock_guard<std::mutex> lock(somEspNowLock);
  if (strcmp(packet.to, "*") != 0 && strcmp(packet.to, somEspNowMe) != 0) return;
  somEspNowQueue[somEspNowWritten % SOM_ESPNOW_QUEUE_SIZE] = packet;
  somEspNowWritten++;
}

// Runs in the WiFi task. The signature changed in ESP-IDF 5.5 (esp32 core 3.3).
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
void somEspNowOnSent(const esp_now_send_info_t *info, esp_now_send_status_t status) {
#else
void somEspNowOnSent(const uint8_t *mac, esp_now_send_status_t status) {
#endif
  if (status == ESP_NOW_SEND_SUCCESS) return;
  std::lock_guard<std::mutex> lock(somEspNowLock);
  somEspNowSendFailed++;
}

// Start ESP-NOW the first time; afterwards only change the name. Safe to call every loop.
void somEspNowBegin(const char *name) {
  {
    std::lock_guard<std::mutex> lock(somEspNowLock);
    somEspNowCopy(somEspNowMe, sizeof(somEspNowMe), name);
  }
  if (somEspNowReady) return;
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(SOM_ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) return;
  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, SOM_ESPNOW_BROADCAST, sizeof(SOM_ESPNOW_BROADCAST));
  peer.channel = SOM_ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    esp_now_deinit();  // try again on the next call
    return;
  }
  esp_now_register_recv_cb(somEspNowOnRecv);
  esp_now_register_send_cb(somEspNowOnSent);
  somEspNowReady = true;
}

// Send value to the board called "to" ("*" = everyone). Returns before anyone receives it.
void somEspNowSend(const String &to, const String &value) {
  if (!somEspNowReady) return;
  SomEspNowPacket packet;
  memset(&packet, 0, sizeof(packet));
  {
    std::lock_guard<std::mutex> lock(somEspNowLock);
    somEspNowCopy(packet.from, sizeof(packet.from), somEspNowMe);
  }
  somEspNowCopy(packet.to, sizeof(packet.to), to.c_str());
  somEspNowCopy(packet.value, sizeof(packet.value), value.c_str());
  esp_now_send(SOM_ESPNOW_BROADCAST, (const uint8_t *)&packet, sizeof(packet));
}

// The next queued message for one "when a message arrives" block (from = nullptr: anyone).
// read is that block's own position; one that fell behind skips the oldest messages.
bool somEspNowNext(uint32_t &read, const char *from) {
  std::lock_guard<std::mutex> lock(somEspNowLock);
  if (somEspNowWritten - read > SOM_ESPNOW_QUEUE_SIZE) {
    somEspNowDropped += somEspNowWritten - read - SOM_ESPNOW_QUEUE_SIZE;
    read = somEspNowWritten - SOM_ESPNOW_QUEUE_SIZE;
  }
  while (read != somEspNowWritten) {
    const SomEspNowPacket &packet = somEspNowQueue[read % SOM_ESPNOW_QUEUE_SIZE];
    read++;
    if (from && strcmp(packet.from, from) != 0) continue;
    somEspNowValue = packet.value;
    somEspNowFrom = packet.from;
    return true;
  }
  return false;
}`;

/**
 * Add the ESP-NOW includes and helpers, or, on a board without ESP-NOW, the translated
 * `#error`. Returns whether the block may emit ESP-NOW code.
 */
function ensureEspNow(generator: ArduinoGenerator): boolean {
  if (!hasEspNow()) {
    compileError(generator, 'espnow', Blockly.Msg['SOM_ESPNOW_NEEDS_ESP32'] ?? '');
    return false;
  }
  for (const header of ['WiFi.h', 'esp_now.h', 'esp_wifi.h', 'mutex']) {
    generator.addInclude(header);
  }
  generator.addDefinition('espnow_helpers', HELPERS);
  return true;
}

function errorText(): string {
  return `ERROR: ${Blockly.Msg['SOM_ESPNOW_NEEDS_ESP32'] ?? ''}`;
}

/** A board name as it travels: trimmed and cut to 15 UTF-8 bytes. */
export function espNowName(raw: string): string {
  return truncateUtf8(raw.trim(), ESPNOW_NAME_MAX_BYTES);
}

/**
 * The `TO` input of a send block: a typed text literal is cut to 15 bytes now, so the code
 * shows the name that really travels; anything else is a String cut at run time.
 */
function targetName(block: Blockly.Block, generator: ArduinoGenerator): string {
  const child = block.getInputTargetBlock('TO');
  if (child?.type === 'text') {
    return cppString(espNowName(String(child.getFieldValue('TEXT') ?? '')));
  }
  return stringInput(block, generator, 'TO', Order.COMMA) ?? '""';
}

function sendValue(block: Blockly.Block, generator: ArduinoGenerator): string {
  return stringInput(block, generator, 'VALUE', Order.COMMA) ?? '""';
}

/** Tooltip message key per block (literal keys, so `pnpm i18n:check` sees them used). */
const TOOLTIP_KEYS: Record<string, string> = {
  som_espnow_name: 'SOM_ESPNOW_NAME_TOOLTIP',
  som_espnow_send_to: 'SOM_ESPNOW_SEND_TO_TOOLTIP',
  som_espnow_send_all: 'SOM_ESPNOW_SEND_ALL_TOOLTIP',
  som_espnow_on_message: 'SOM_ESPNOW_ON_MESSAGE_TOOLTIP',
  som_espnow_msg_value: 'SOM_ESPNOW_MSG_VALUE_TOOLTIP',
  som_espnow_msg_sender: 'SOM_ESPNOW_MSG_SENDER_TOOLTIP',
  som_espnow_msg_as_number: 'SOM_ESPNOW_MSG_AS_NUMBER_TOOLTIP',
};

/**
 * Tooltip: the block's own text, prefixed with "ESP32 only" while another board is selected.
 * Read on hover, so it follows the board picker and the language without re-creating blocks.
 */
function tooltipExtension(this: Blockly.Block): void {
  const key = TOOLTIP_KEYS[this.type] ?? '';
  this.setTooltip(() => {
    const text = Blockly.Msg[key] ?? '';
    return hasEspNow() ? text : `${Blockly.Msg['SOM_ESPNOW_ONLY_ESP32'] ?? ''} ${text}`;
  });
}

/** `when a message arrives from`: the name field shows only when "the board…" is picked. */
function fromToggleExtension(this: Blockly.Block): void {
  const name = this.getField('NAME');
  const mode = this.getField('MODE');
  if (!name || !mode) return;
  const update = (value: unknown): void => name.setVisible(value === 'NAME');
  mode.setValidator((value: string) => {
    update(value);
    return undefined;
  });
  update(mode.getValue());
}

const statement = { previousStatement: null, nextStatement: null, colour: COLOUR };
const ext = { extensions: [TOOLTIP_EXTENSION] };

export const espnowFamily: BlockFamily = {
  id: 'espnow',
  blocks: [
    {
      type: 'som_espnow_name',
      message0: '%{BKY_SOM_ESPNOW_NAME}',
      args0: [{ type: 'field_input', name: 'NAME', text: '%{BKY_SOM_ESPNOW_NAME_DEFAULT}' }],
      ...statement,
      ...ext,
    },
    {
      type: 'som_espnow_send_to',
      message0: '%{BKY_SOM_ESPNOW_SEND_TO}',
      args0: [
        { type: 'input_value', name: 'VALUE', check: ['Number', 'String'] },
        { type: 'input_value', name: 'TO', check: 'String' },
      ],
      inputsInline: true,
      ...statement,
      ...ext,
    },
    {
      type: 'som_espnow_send_all',
      message0: '%{BKY_SOM_ESPNOW_SEND_ALL}',
      args0: [{ type: 'input_value', name: 'VALUE', check: ['Number', 'String'] }],
      inputsInline: true,
      ...statement,
      ...ext,
    },
    {
      type: 'som_espnow_on_message',
      message0: '%{BKY_SOM_ESPNOW_ON_MESSAGE}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['%{BKY_SOM_ESPNOW_FROM_ANYONE}', 'ANY'],
            ['%{BKY_SOM_ESPNOW_FROM_NAMED}', 'NAME'],
          ],
        },
        { type: 'field_input', name: 'NAME', text: '%{BKY_SOM_ESPNOW_FROM_DEFAULT}' },
      ],
      message1: '%{BKY_SOM_ESPNOW_ON_MESSAGE_DO}',
      args1: [{ type: 'input_statement', name: 'DO' }],
      ...statement,
      extensions: [TOOLTIP_EXTENSION, FROM_EXTENSION],
    },
    {
      type: 'som_espnow_msg_value',
      message0: '%{BKY_SOM_ESPNOW_MSG_VALUE}',
      output: 'String',
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_espnow_msg_sender',
      message0: '%{BKY_SOM_ESPNOW_MSG_SENDER}',
      output: 'String',
      colour: COLOUR,
      ...ext,
    },
    {
      type: 'som_espnow_msg_as_number',
      message0: '%{BKY_SOM_ESPNOW_MSG_AS_NUMBER}',
      output: 'Number',
      colour: COLOUR,
      ...ext,
    },
  ],
  extensions: {
    [TOOLTIP_EXTENSION]: tooltipExtension,
    [FROM_EXTENSION]: fromToggleExtension,
  },
  generators: {
    som_espnow_name: (block, generator) => {
      if (!ensureEspNow(generator)) return `// ${errorText()}\n`;
      const name = espNowName(String(block.getFieldValue('NAME') ?? ''));
      return `somEspNowBegin(${cppString(name || ESPNOW_DEFAULT_NAME)});\n`;
    },
    som_espnow_send_to: (block, generator) => {
      if (!ensureEspNow(generator)) return `// ${errorText()}\n`;
      return `somEspNowSend(${targetName(block, generator)}, ${sendValue(block, generator)});\n`;
    },
    som_espnow_send_all: (block, generator) => {
      if (!ensureEspNow(generator)) return `// ${errorText()}\n`;
      return `somEspNowSend("*", ${sendValue(block, generator)});\n`;
    },
    som_espnow_on_message: (block, generator) => {
      if (!ensureEspNow(generator)) return `// ${errorText()}\n`;
      if (!generator.nameDB_) throw new Error('ArduinoGenerator used before init()');
      const read = generator.nameDB_.getDistinctName(
        'som_espnow_read',
        Blockly.Names.NameType.VARIABLE,
      );
      generator.addDefinition(`som_espnow_on_message_${read}`, `static uint32_t ${read} = 0;`);
      // An empty name filters nothing, like "anyone".
      const name =
        block.getFieldValue('MODE') === 'NAME'
          ? espNowName(String(block.getFieldValue('NAME') ?? ''))
          : '';
      const from = name ? cppString(name) : 'nullptr';
      const body = generator.statementToCode(block, 'DO');
      return `while (somEspNowNext(${read}, ${from})) {\n${body}}\n`;
    },
    som_espnow_msg_value: (_block, generator) => {
      if (!ensureEspNow(generator)) return [`/* ${errorText()} */ String("")`, Order.ATOMIC];
      return ['somEspNowValue', Order.ATOMIC];
    },
    som_espnow_msg_sender: (_block, generator) => {
      if (!ensureEspNow(generator)) return [`/* ${errorText()} */ String("")`, Order.ATOMIC];
      return ['somEspNowFrom', Order.ATOMIC];
    },
    som_espnow_msg_as_number: (_block, generator) => {
      if (!ensureEspNow(generator)) return [`/* ${errorText()} */ 0`, Order.ATOMIC];
      return ['somEspNowValue.toFloat()', Order.POSTFIX];
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_ESPNOW_CATEGORY}',
    colour: COLOUR,
    contents: [
      { kind: 'block', type: 'som_espnow_name' },
      {
        kind: 'block',
        type: 'som_espnow_send_to',
        inputs: {
          VALUE: { shadow: { type: 'text', fields: { TEXT: 'hola' } } },
          TO: { shadow: { type: 'text', fields: { TEXT: 'placa2' } } },
        },
      },
      {
        kind: 'block',
        type: 'som_espnow_send_all',
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hola' } } } },
      },
      { kind: 'block', type: 'som_espnow_on_message' },
      { kind: 'block', type: 'som_espnow_msg_value' },
      { kind: 'block', type: 'som_espnow_msg_sender' },
      { kind: 'block', type: 'som_espnow_msg_as_number' },
    ],
  },
  messages: {
    es: {
      SOM_ESPNOW_CATEGORY: 'ESP-NOW',
      SOM_ESPNOW_ONLY_ESP32: 'Solo ESP32.',
      SOM_ESPNOW_NEEDS_ESP32:
        'Los bloques ESP-NOW solo funcionan en una placa ESP32. Elige la ESP32-C3 en "Placa".',
      SOM_ESPNOW_NAME: 'mi nombre es %1',
      SOM_ESPNOW_NAME_DEFAULT: 'placa1',
      SOM_ESPNOW_NAME_TOOLTIP:
        'Le da un nombre a tu placa para hablar con otras placas sin router. Úsalo antes de enviar. Máximo 15 letras, distinto al de tus compañeros. No lo mezcles con los bloques WiFi.',
      SOM_ESPNOW_SEND_TO: 'enviar %1 a %2',
      SOM_ESPNOW_SEND_TO_TOOLTIP:
        'Envía un texto o número a la placa con ese nombre. Escribe el nombre igual que en la otra placa. Máximo 199 letras. No avisa si llegó.',
      SOM_ESPNOW_SEND_ALL: 'enviar %1 a todos',
      SOM_ESPNOW_SEND_ALL_TOOLTIP:
        'Envía un texto o número a todas las placas cercanas. Máximo 199 letras. No avisa si llegó.',
      SOM_ESPNOW_ON_MESSAGE: 'cuando llegue un mensaje de %1 %2',
      SOM_ESPNOW_FROM_ANYONE: 'cualquiera',
      SOM_ESPNOW_FROM_NAMED: 'la placa',
      SOM_ESPNOW_FROM_DEFAULT: 'placa2',
      SOM_ESPNOW_ON_MESSAGE_DO: 'hacer %1',
      SOM_ESPNOW_ON_MESSAGE_TOOLTIP:
        'Hace estos bloques una vez por cada mensaje que llega para ti o para todos. Elige "cualquiera" o el nombre de una placa. Si llegan más de 8 juntos, se pierden los más viejos.',
      SOM_ESPNOW_MSG_VALUE: 'mensaje recibido',
      SOM_ESPNOW_MSG_VALUE_TOOLTIP:
        'El texto del mensaje que llegó. Úsalo dentro de "cuando llegue un mensaje".',
      SOM_ESPNOW_MSG_SENDER: 'quién lo envió',
      SOM_ESPNOW_MSG_SENDER_TOOLTIP:
        'El nombre de la placa que envió el mensaje. Sirve para responderle.',
      SOM_ESPNOW_MSG_AS_NUMBER: 'mensaje recibido como número',
      SOM_ESPNOW_MSG_AS_NUMBER_TOOLTIP:
        'El mensaje que llegó, como número. Da 0 si no es un número.',
    },
    en: {
      SOM_ESPNOW_CATEGORY: 'ESP-NOW',
      SOM_ESPNOW_ONLY_ESP32: 'ESP32 only.',
      SOM_ESPNOW_NEEDS_ESP32:
        'ESP-NOW blocks only work on an ESP32 board. Pick the ESP32-C3 in "Board".',
      SOM_ESPNOW_NAME: 'my name is %1',
      SOM_ESPNOW_NAME_DEFAULT: 'board1',
      SOM_ESPNOW_NAME_TOOLTIP:
        'Gives your board a name so it can talk to other boards without a router. Use it before sending. At most 15 letters, different from your classmates’. Don’t mix it with the WiFi blocks.',
      SOM_ESPNOW_SEND_TO: 'send %1 to %2',
      SOM_ESPNOW_SEND_TO_TOOLTIP:
        'Sends text or a number to the board with that name. Type the name exactly as on the other board. At most 199 letters. It doesn’t tell you if it arrived.',
      SOM_ESPNOW_SEND_ALL: 'send %1 to everyone',
      SOM_ESPNOW_SEND_ALL_TOOLTIP:
        'Sends text or a number to every board nearby. At most 199 letters. It doesn’t tell you if it arrived.',
      SOM_ESPNOW_ON_MESSAGE: 'when a message arrives from %1 %2',
      SOM_ESPNOW_FROM_ANYONE: 'anyone',
      SOM_ESPNOW_FROM_NAMED: 'the board',
      SOM_ESPNOW_FROM_DEFAULT: 'board2',
      SOM_ESPNOW_ON_MESSAGE_DO: 'do %1',
      SOM_ESPNOW_ON_MESSAGE_TOOLTIP:
        'Runs these blocks once for every message sent to you or to everyone. Pick "anyone" or the name of a board. If more than 8 arrive at once, the oldest are lost.',
      SOM_ESPNOW_MSG_VALUE: 'received message',
      SOM_ESPNOW_MSG_VALUE_TOOLTIP:
        'The text of the message that arrived. Use it inside "when a message arrives".',
      SOM_ESPNOW_MSG_SENDER: 'who sent it',
      SOM_ESPNOW_MSG_SENDER_TOOLTIP:
        'The name of the board that sent the message. Use it to answer back.',
      SOM_ESPNOW_MSG_AS_NUMBER: 'received message as a number',
      SOM_ESPNOW_MSG_AS_NUMBER_TOOLTIP:
        'The message that arrived, as a number. Gives 0 when it is not a number.',
    },
  },
};
