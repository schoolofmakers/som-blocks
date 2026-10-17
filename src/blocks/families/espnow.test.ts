import * as Blockly from 'blockly/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  disposeTestWorkspace,
  generate,
  load,
  num,
  stack,
  type BlockState,
} from '../__golden__/test-support';
import { esp32c3SuperMini } from '../../boards/definitions/esp32c3-supermini';
import { uno } from '../../boards/definitions/uno';
import type { Chip } from '../../boards/types';
import { registerBuiltInFamilies } from '../index';
import { setCurrentChip, setPinProfile } from '../pins';
import { applyLocale } from '../registry';
import {
  ESPNOW_DEFAULT_NAME,
  ESPNOW_NAME_MAX_BYTES,
  ESPNOW_VALUE_MAX_BYTES,
  espNowName,
  espnowFamily,
  hasEspNow,
} from './espnow';

beforeEach(() => {
  registerBuiltInFamilies();
  applyLocale('es');
  setPinProfile(esp32c3SuperMini.pins);
  setCurrentChip('esp32c3');
});

afterEach(() => {
  disposeTestWorkspace();
  setPinProfile(uno.pins);
  setCurrentChip('avr');
});

const name = (value: string): BlockState => ({ type: 'som_espnow_name', fields: { NAME: value } });
const text = (value: string): BlockState => ({ type: 'text', fields: { TEXT: value } });
const sendAll = (value?: BlockState): BlockState => ({
  type: 'som_espnow_send_all',
  ...(value ? { inputs: { VALUE: { block: value } } } : {}),
});
const sendTo = (value?: BlockState, to?: BlockState): BlockState => ({
  type: 'som_espnow_send_to',
  inputs: {
    ...(value ? { VALUE: { block: value } } : {}),
    ...(to ? { TO: { block: to } } : {}),
  },
});
const onMessage = (from: string | null, body?: BlockState): BlockState => ({
  type: 'som_espnow_on_message',
  fields: from === null ? { MODE: 'ANY', NAME: 'x' } : { MODE: 'NAME', NAME: from },
  ...(body ? { inputs: { DO: { block: body } } } : {}),
});
const println = (value: BlockState): BlockState => ({
  type: 'som_serial_println',
  inputs: { VALUE: { block: value } },
});

/** The body of a generated C++ function, by its signature prefix. */
function functionBody(code: string, signature: string): string {
  const start = code.indexOf(signature);
  if (start < 0) return '';
  const end = code.indexOf('\n}\n', start);
  return code.slice(start, end);
}

describe('espnow on the ESP32-C3', () => {
  it('name: includes, helpers once, and an idempotent somEspNowBegin call', () => {
    const code = generate(stack(name('placa1'), name('otra')));
    for (const header of ['WiFi.h', 'esp_now.h', 'esp_wifi.h', 'mutex']) {
      expect(code.split(`#include <${header}>`)).toHaveLength(2);
    }
    expect(code.match(/void somEspNowBegin\(/g)).toHaveLength(1);
    expect(code).toContain('somEspNowBegin("placa1");\n  somEspNowBegin("otra");');
    const begin = functionBody(code, 'void somEspNowBegin(');
    expect(begin).toContain('if (somEspNowReady) return;');
    expect(begin).toContain('WiFi.mode(WIFI_STA);');
    expect(begin).toContain('esp_wifi_set_channel(SOM_ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);');
    expect(begin).toContain('esp_now_init()');
    expect(begin).toContain('peer.encrypt = false;');
    expect(begin).toContain('esp_now_register_recv_cb(somEspNowOnRecv);');
    expect(begin).toContain('esp_now_register_send_cb(somEspNowOnSent);');
    // The name is updated before the early return, so renaming in loop() works.
    expect(begin.indexOf('somEspNowCopy(somEspNowMe')).toBeLessThan(
      begin.indexOf('if (somEspNowReady) return;'),
    );
    expect(code).not.toContain('#error');
  });

  it('broadcasts on channel 1 to FF:FF:FF:FF:FF:FF, and checks the payload fits in 250 bytes', () => {
    const code = generate(name('a'));
    expect(code).toContain('SOM_ESPNOW_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};');
    expect(code).toContain('const uint8_t SOM_ESPNOW_CHANNEL = 1;');
    expect(code).toContain(`char from[${ESPNOW_NAME_MAX_BYTES + 1}];`);
    expect(code).toContain(`char to[${ESPNOW_NAME_MAX_BYTES + 1}];`);
    expect(code).toContain(`char value[${ESPNOW_VALUE_MAX_BYTES + 1}];`);
    expect(code).toContain('static_assert(sizeof(SomEspNowPacket) <= ESP_NOW_MAX_DATA_LEN');
    // 16 + 16 + 200 chars, no padding: well under ESP-NOW's 250 bytes.
    expect(2 * (ESPNOW_NAME_MAX_BYTES + 1) + ESPNOW_VALUE_MAX_BYTES + 1).toBeLessThanOrEqual(250);
  });

  it('uses the 3.x receive callback and the send callback for both ESP-IDF signatures', () => {
    const code = generate(name('a'));
    expect(code).toContain(
      'void somEspNowOnRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {',
    );
    expect(code).toContain(
      '#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)\n' +
        'void somEspNowOnSent(const esp_now_send_info_t *info, esp_now_send_status_t status) {\n' +
        '#else\n' +
        'void somEspNowOnSent(const uint8_t *mac, esp_now_send_status_t status) {\n' +
        '#endif',
    );
  });

  it('the receive callback only copies into the queue; no student code runs there', () => {
    const code = generate(stack(name('a'), onMessage(null, sendAll(text('hola')))));
    const recv = functionBody(code, 'void somEspNowOnRecv(');
    expect(recv).toContain('if (len != (int)sizeof(SomEspNowPacket)) return;');
    expect(recv).toContain('std::lock_guard<std::mutex> lock(somEspNowLock);');
    expect(recv).toContain(
      'if (strcmp(packet.to, "*") != 0 && strcmp(packet.to, somEspNowMe) != 0) return;',
    );
    expect(recv).toContain('somEspNowQueue[somEspNowWritten % SOM_ESPNOW_QUEUE_SIZE] = packet;');
    // Received text is forced to end inside each field, whatever the sender put there.
    for (const field of ['from', 'to', 'value']) {
      expect(recv).toContain(`packet.${field}[sizeof(packet.${field}) - 1] = '\\0';`);
    }
    expect(recv).not.toContain('somEspNowSend');
    // The body runs from loop().
    expect(code).toContain(
      'void loop() {\n  somEspNowBegin("a");\n' +
        '  while (somEspNowNext(som_espnow_read, nullptr)) {\n    somEspNowSend("*", "hola");',
    );
  });

  it('copies with strncpy, cuts at a whole UTF-8 character and always null-terminates', () => {
    const code = generate(sendAll(text('x')));
    const copy = functionBody(code, 'void somEspNowCopy(');
    expect(copy).toContain('strncpy(field, text, end);');
    expect(copy).toContain('while (end > 0 && ((uint8_t)text[end] & 0xC0) == 0x80) end--;');
    expect(copy).toContain("field[end] = '\\0';");
    const send = functionBody(code, 'void somEspNowSend(');
    expect(send).toContain('if (!somEspNowReady) return;');
    expect(send).toContain('memset(&packet, 0, sizeof(packet));');
    expect(send).toContain('somEspNowCopy(packet.value, sizeof(packet.value), value.c_str());');
  });

  it('a hat nested in another gives the outer one its message back', () => {
    const inner = onMessage('b', println({ type: 'som_espnow_msg_value' }));
    const outer = onMessage(
      null,
      stack(inner, sendTo({ type: 'som_espnow_msg_value' }, { type: 'som_espnow_msg_sender' })),
    );
    const code = generate(outer);
    expect(code).toContain(
      '  while (somEspNowNext(som_espnow_read, nullptr)) {\n' +
        '    {\n' +
        '      String som_espnow_outer_value = somEspNowValue;\n' +
        '      String som_espnow_outer_from = somEspNowFrom;\n' +
        '      while (somEspNowNext(som_espnow_read2, "b")) {\n' +
        '        Serial.println(somEspNowValue);\n' +
        '      }\n' +
        '      somEspNowValue = som_espnow_outer_value;\n' +
        '      somEspNowFrom = som_espnow_outer_from;\n' +
        '    }\n' +
        '    somEspNowSend(somEspNowFrom, somEspNowValue);\n',
    );
    // A top-level hat stays a plain loop.
    expect(generate(onMessage(null))).not.toContain('som_espnow_outer_value');
  });

  it('toolbox examples follow the language; send and receive default to the same board', () => {
    const shadowText = (type: string, input: string): unknown => {
      const item = espnowFamily.toolbox;
      if (Array.isArray(item)) throw new Error('expected a category');
      const block = item.contents.find((c) => c.kind === 'block' && c.type === type);
      const inputs = (
        block as { inputs?: Record<string, { shadow: { fields: { TEXT: string } } }> }
      ).inputs;
      return inputs?.[input]?.shadow.fields.TEXT;
    };
    expect(shadowText('som_espnow_send_to', 'VALUE')).toBe('hola');
    expect(shadowText('som_espnow_send_to', 'TO')).toBe('placa2');
    applyLocale('en');
    expect(shadowText('som_espnow_send_to', 'VALUE')).toBe('hello');
    expect(shadowText('som_espnow_send_all', 'VALUE')).toBe('hello');
    expect(shadowText('som_espnow_send_to', 'TO')).toBe(Blockly.Msg['SOM_ESPNOW_FROM_DEFAULT']);
    expect(shadowText('som_espnow_send_to', 'TO')).toBe('board2');
  });

  it('a hat that falls behind skips the oldest messages and counts them', () => {
    const next = functionBody(generate(onMessage(null)), 'bool somEspNowNext(');
    expect(next).toContain('if (somEspNowWritten - read > SOM_ESPNOW_QUEUE_SIZE) {');
    expect(next).toContain('somEspNowDropped += somEspNowWritten - read - SOM_ESPNOW_QUEUE_SIZE;');
    expect(next).toContain('if (from && strcmp(packet.from, from) != 0) continue;');
  });

  it('each `when a message arrives` block keeps its own read position', () => {
    const code = generate(stack(onMessage(null), onMessage('sensor')));
    expect(code).toContain('static uint32_t som_espnow_read = 0;');
    expect(code).toContain('static uint32_t som_espnow_read2 = 0;');
    expect(code).toContain('while (somEspNowNext(som_espnow_read, nullptr)) {\n  }');
    expect(code).toContain('while (somEspNowNext(som_espnow_read2, "sensor")) {\n  }');
  });

  it('a student variable named like the read index gets renamed, not the helper', () => {
    const variable: BlockState = {
      type: 'variables_set',
      fields: { VAR: { id: 'v', name: 'som_espnow_read' } },
      inputs: { VALUE: { block: num(1) } },
    };
    const code = generate(stack(variable, onMessage(null)));
    expect(code).toContain('som_espnow_read = 1;');
    expect(code).toContain('while (somEspNowNext(som_espnow_read2, nullptr))');
  });

  it('a student variable named like a helper is renamed', () => {
    const variable: BlockState = {
      type: 'variables_set',
      fields: { VAR: { id: 'v', name: 'somEspNowValue' } },
      inputs: { VALUE: { block: num(1) } },
    };
    expect(generate(variable)).toContain('somEspNowValue2 = 1;');
  });

  it('send to a name and to everyone; numbers become text', () => {
    const code = generate(
      stack(sendTo(num(42), text('placa2')), sendAll(num(7)), sendTo(), sendAll()),
    );
    expect(code).toContain('somEspNowSend("placa2", String(42));');
    expect(code).toContain('somEspNowSend("*", String(7));');
    expect(code).toContain('somEspNowSend("", "");');
    expect(code).toContain('somEspNowSend("*", "");');
  });

  it('reply to whoever sent the message', () => {
    const body = sendTo({ type: 'som_espnow_msg_value' }, { type: 'som_espnow_msg_sender' });
    expect(generate(onMessage(null, body))).toContain(
      'somEspNowSend(somEspNowFrom, somEspNowValue);',
    );
  });

  it('message as a number uses toFloat (0 when not numeric)', () => {
    const compare: BlockState = {
      type: 'logic_compare',
      fields: { OP: 'GT' },
      inputs: {
        A: { block: { type: 'som_espnow_msg_as_number' } },
        B: { block: num(50) },
      },
    };
    const code = generate(
      onMessage(null, { type: 'controls_if', inputs: { IF0: { block: compare } } }),
    );
    expect(code).toContain('if (somEspNowValue.toFloat() > 50) {');
  });

  it('cuts names to 15 bytes when the code is generated, without splitting a character', () => {
    const long = 'ñandúcompañero123';
    const cut = espNowName(long);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(ESPNOW_NAME_MAX_BYTES);
    expect(long.startsWith(cut)).toBe(true);
    const code = generate(stack(name(long), sendTo(text('x'), text(long)), onMessage(long)));
    expect(code).toContain(`somEspNowBegin("${cut}");`);
    expect(code).toContain(`somEspNowSend("${cut}", "x");`);
    expect(code).toContain(`somEspNowNext(som_espnow_read, "${cut}")`);
  });

  it('an empty name falls back to the default; an empty sender filter means anyone', () => {
    const code = generate(stack(name('   '), onMessage('')));
    expect(code).toContain(`somEspNowBegin("${ESPNOW_DEFAULT_NAME}");`);
    expect(code).toContain('somEspNowNext(som_espnow_read, nullptr)');
  });

  it('escapes quotes in names', () => {
    expect(generate(name('a"b'))).toContain('somEspNowBegin("a\\"b");');
  });

  it('the sender name field shows only when "la placa" is picked', () => {
    const workspace = load(onMessage(null), onMessage('sensor'));
    const [any, named] = workspace.getTopBlocks(true);
    expect(any?.getField('NAME')?.isVisible()).toBe(false);
    expect(named?.getField('NAME')?.isVisible()).toBe(true);
    any?.setFieldValue('NAME', 'MODE');
    expect(any?.getField('NAME')?.isVisible()).toBe(true);
  });
});

describe('espnow on boards without ESP-NOW', () => {
  it.each<Chip>(['avr', 'esp8266'])('%s: one translated #error and no ESP-NOW code', (chip) => {
    setCurrentChip(chip);
    expect(hasEspNow()).toBe(false);
    const code = generate(
      stack(
        name('a'),
        sendAll(text('x')),
        sendTo(text('x'), text('b')),
        onMessage(null),
        println({ type: 'som_espnow_msg_value' }),
        println({ type: 'som_espnow_msg_sender' }),
        println({ type: 'som_espnow_msg_as_number' }),
      ),
    );
    expect(code.match(/#error /g)).toHaveLength(1);
    expect(code).toContain(
      '#error "Los bloques ESP-NOW solo funcionan en una placa ESP32. Elige la ESP32-C3 en \\"Placa\\"."',
    );
    expect(code).not.toContain('esp_now.h');
    expect(code).not.toContain('somEspNow');
    expect(code.match(/\/\/ ERROR: /g)).toHaveLength(4);
    expect(code).toContain('Serial.println(/* ERROR: ');
  });

  it('tooltips say "Solo ESP32." while another board is selected', () => {
    const workspace = load(name('a'));
    const block = workspace.getTopBlocks(false)[0];
    if (!block) throw new Error('no block');
    const tooltip = (): string => Blockly.Tooltip.getTooltipOfObject(block);
    expect(tooltip()).toBe(Blockly.Msg['SOM_ESPNOW_NAME_TOOLTIP']);
    setCurrentChip('avr');
    expect(tooltip()).toBe(`Solo ESP32. ${Blockly.Msg['SOM_ESPNOW_NAME_TOOLTIP']}`);
  });

  it('esp32 and esp32c3 have ESP-NOW', () => {
    expect(hasEspNow('esp32')).toBe(true);
    expect(hasEspNow('esp32c3')).toBe(true);
  });
});
