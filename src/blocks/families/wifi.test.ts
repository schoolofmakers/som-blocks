import * as Blockly from 'blockly/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  disposeTestWorkspace,
  generate,
  load,
  setupBody,
  stack,
  type BlockState,
} from '../__golden__/test-support';
import { registerBuiltInFamilies } from '../index';
import { setCurrentChip } from '../pins';
import { applyLocale } from '../registry';
import { hasEsp32Wifi, wifiFamily } from './wifi';

beforeAll(() => {
  registerBuiltInFamilies();
});

beforeEach(() => {
  applyLocale('es');
  setCurrentChip('esp32c3');
});

afterEach(() => {
  disposeTestWorkspace();
  setCurrentChip('esp32c3');
});

const connect: BlockState = {
  type: 'som_wifi_connect',
  fields: { SSID: 'Aula', PASSWORD: 'clave' },
};
const text = (t: string): BlockState => ({ type: 'text', fields: { TEXT: t } });
const println = (value: BlockState): BlockState => ({
  type: 'som_serial_println',
  inputs: { VALUE: { block: value } },
});
const get = (url?: BlockState): BlockState => ({
  type: 'som_wifi_http_get',
  ...(url ? { inputs: { URL: { block: url } } } : {}),
});

describe('wifi on the ESP32-C3', () => {
  it('connect emits the bounded helper, WiFi.mode in setup and one call', () => {
    const code = generate(connect);
    expect(code.match(/#include <WiFi\.h>/g)).toHaveLength(1);
    expect(code).toContain('bool somWifiConnect(const char *ssid, const char *pass');
    expect(code).toContain('millis() - start < timeoutMs');
    expect(setupBody(code)).toEqual(['WiFi.mode(WIFI_STA);']);
    expect(code).toContain('somWifiConnect("Aula", "clave", 15000);');
  });

  it('prints dots only when the program uses the serial port', () => {
    expect(generate(connect)).not.toContain('Serial');
    const withSerial = generate(stack(connect, println(text('hola'))));
    expect(withSerial).toContain('    Serial.print(".");');
  });

  it('WiFi.mode is only in setup when a connect block exists', () => {
    const code = generate(println({ type: 'som_wifi_ip' }));
    expect(code).toContain('Serial.println(WiFi.localIP().toString());');
    expect(setupBody(code)).toEqual(['Serial.begin(115200);']);
  });

  it('two connect blocks share one helper', () => {
    const code = generate(stack(connect, { ...connect, fields: { SSID: 'Otra', PASSWORD: '' } }));
    expect(code.match(/bool somWifiConnect\(/g)).toHaveLength(1);
    expect(code).toContain('somWifiConnect("Otra", "", 15000);');
  });

  it('escapes quotes and backslashes in the network name and password', () => {
    const code = generate({ type: 'som_wifi_connect', fields: { SSID: 'a"b', PASSWORD: 'c\\d' } });
    expect(code).toContain('somWifiConnect("a\\"b", "c\\\\d", 15000);');
  });

  it('value blocks: connected, signal, IP', () => {
    const code = generate(
      stack(
        println({ type: 'som_wifi_connected' }),
        println({ type: 'som_wifi_signal' }),
        println({ type: 'som_wifi_ip' }),
      ),
    );
    expect(code).toContain('Serial.println(WiFi.status() == WL_CONNECTED);');
    expect(code).toContain('Serial.println(WiFi.RSSI());');
  });

  it('GET adds the includes and helpers once and returns the body or ""', () => {
    const code = generate(
      stack(println(get(text('https://a.cl'))), println(get(text('http://b.cl')))),
    );
    for (const header of ['WiFi.h', 'HTTPClient.h', 'WiFiClientSecure.h']) {
      expect(code.split(`#include <${header}>`)).toHaveLength(2);
    }
    expect(code.match(/String somHttpRequest\(/g)).toHaveLength(1);
    expect(code.match(/String somHttpGet\(/g)).toHaveLength(1);
    expect(code).not.toContain('somHttpPost(');
    expect(code).toContain('secure.setInsecure();');
    expect(code).toContain('? http.getString() : String("")');
    expect(code).toContain('Serial.println(somHttpGet("https://a.cl"));');
  });

  it('GET with an empty or non-text URL still compiles', () => {
    expect(generate(println(get()))).toContain('somHttpGet("")');
    // An untyped (double) variable: Blockly lets it into a String socket.
    const numberUrl: BlockState = {
      type: 'variables_get',
      fields: { VAR: { id: 'v', name: 'n' } },
    };
    expect(generate(println(get(numberUrl)))).toContain('somHttpGet(String(n))');
  });

  it('POST passes body and the content type; both dropdown types', () => {
    const post = (type: string): BlockState => ({
      type: 'som_wifi_http_post',
      fields: { TYPE: type },
      inputs: { BODY: { block: text('{"a":1}') }, URL: { block: text('http://x.cl') } },
    });
    const code = generate(println(post('application/json')));
    expect(code).toContain('somHttpPost("http://x.cl", "{\\"a\\":1}", "application/json")');
    expect(code).toContain('http.addHeader("Content-Type", contentType);');
    expect(generate(println(post('text/plain')))).toContain('"text/plain")');
  });

  it('a student variable called WiFi is renamed, never shadowing the WiFi object', () => {
    const code = generate(
      stack(
        {
          type: 'variables_set',
          fields: { VAR: { id: 'w', name: 'WiFi' } },
          inputs: { VALUE: { block: { type: 'math_number', fields: { NUM: 1 } } } },
        },
        connect,
      ),
    );
    expect(code).toContain('double WiFi2 = 0;');
    expect(code).toContain('WiFi2 = 1;');
  });

  it.each(['WL_CONNECTED', 'WIFI_STA', 'HTTPC_STRICT_FOLLOW_REDIRECTS', 'somHttpGet'])(
    'a student variable called %s is renamed',
    (name) => {
      const code = generate(
        stack(
          {
            type: 'variables_set',
            fields: { VAR: { id: 'v', name } },
            inputs: { VALUE: { block: { type: 'math_number', fields: { NUM: 1 } } } },
          },
          connect,
        ),
      );
      expect(code).toContain(`double ${name}2 = 0;`);
      expect(code).not.toContain(`double ${name} = 0;`);
    },
  );

  it('disconnect', () => {
    expect(generate({ type: 'som_wifi_disconnect' })).toContain('  WiFi.disconnect();\n');
  });

  it('tooltips are plain while an ESP32 is selected', () => {
    const workspace = load(connect);
    const block = workspace.getTopBlocks(false)[0]!;
    expect(Blockly.Tooltip.getTooltipOfObject(block)).toBe(Blockly.Msg['SOM_WIFI_CONNECT_TOOLTIP']);
  });
});

describe('wifi on a board without WiFi (AVR)', () => {
  beforeEach(() => {
    setCurrentChip('avr');
  });

  it('emits no WiFi code, an ERROR comment per block and one translated #error', () => {
    const code = generate(
      stack(
        connect,
        println({ type: 'som_wifi_ip' }),
        println({ type: 'som_wifi_connected' }),
        println({ type: 'som_wifi_signal' }),
        println(get(text('http://a.cl'))),
        { type: 'som_wifi_disconnect' },
      ),
    );
    expect(code).not.toMatch(/#include <(WiFi|HTTPClient|WiFiClientSecure)\.h>/);
    expect(code).not.toMatch(/WiFi\.|somWifi|somHttp/);
    const message = Blockly.Msg['SOM_WIFI_NEEDS_ESP32'];
    expect(message).toContain('ESP32');
    expect(code.match(/#error /g)).toHaveLength(1);
    expect(code).toContain(`#error "Los bloques WiFi solo funcionan en una placa ESP32.`);
    expect(code.match(/\/\/ ERROR: /g)).toHaveLength(2);
    expect(code.match(/\/\* ERROR: /g)).toHaveLength(4);
  });

  it('the #error follows the language', () => {
    applyLocale('en');
    expect(generate(connect)).toContain('#error "WiFi blocks only work on an ESP32 board.');
  });

  it('tooltips start with "Solo ESP32."', () => {
    const workspace = load(connect);
    const block = workspace.getTopBlocks(false)[0]!;
    expect(Blockly.Tooltip.getTooltipOfObject(block)).toBe(
      `Solo ESP32. ${Blockly.Msg['SOM_WIFI_CONNECT_TOOLTIP']}`,
    );
  });
});

describe('wifi tooltips', () => {
  it('every wifi block has its own non-empty tooltip in both languages', () => {
    for (const lang of ['es', 'en'] as const) {
      applyLocale(lang);
      for (const def of wifiFamily.blocks) {
        const workspace = load({ type: def.type });
        const block = workspace.getTopBlocks(false)[0]!;
        const tooltip = Blockly.Tooltip.getTooltipOfObject(block);
        expect(tooltip, `${lang} ${def.type}`).toBe(
          Blockly.Msg[`${def.type.toUpperCase()}_TOOLTIP`],
        );
        expect(tooltip.length, `${lang} ${def.type}`).toBeGreaterThan(10);
      }
    }
  });
});

describe('hasEsp32Wifi', () => {
  it('is true for esp32 chips only', () => {
    expect(hasEsp32Wifi('esp32c3')).toBe(true);
    expect(hasEsp32Wifi('esp32')).toBe(true);
    expect(hasEsp32Wifi('avr')).toBe(false);
    expect(hasEsp32Wifi('esp8266')).toBe(false);
  });
});
