import * as Blockly from 'blockly/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { esp32c3SuperMini } from '../boards/definitions/esp32c3-supermini';
import { uno } from '../boards/definitions/uno';
import { arduinoGenerator, RESERVED_WORDS } from './arduino-generator';
import { registerBuiltInFamilies } from './index';
import { setCurrentChip, setPinProfile } from './pins';
import { applyLocale } from './registry';

// Every global, class and helper the families put in the sketch must be out of reach of a
// student's variable or function name (#32): a variable called `somBleStart` would otherwise
// redefine the helper and the sketch would not compile. The identifiers are collected from
// the golden sketches, which golden.test.ts pins byte-for-byte to the generator's output.

type BlockState = Blockly.serialization.blocks.State;

const goldenSketches = import.meta.glob<string>('./__golden__/fixtures/*.ino', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** The code of a sketch without includes, comments and string literals (UUIDs, messages…). */
function codeOnly(sketch: string): string {
  return sketch
    .replace(/^#include.*$/gm, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function identifiers(pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const sketch of Object.values(goldenSketches)) {
    for (const match of codeOnly(sketch).matchAll(pattern)) found.add(match[0]);
  }
  return [...found].sort();
}

// Our helpers: `som…` / `Som…` / `SOM_…`. Library names they use: the ESP32 BLE / WiFi /
// HTTP classes and constants, `std` (std::mutex), the ESP-IDF ESP-NOW / WiFi API
// (`esp_…`, `ESP_…`, `WIFI_…`) and the C string functions (`str…`, `mem…`).
const ourNames = identifiers(/\b(?:som|Som|SOM)[A-Za-z0-9_]*\b/g);
const libraryNames = identifiers(
  /\b(?:BLE[A-Za-z0-9_]*|WiFi[A-Za-z]*|HTTP[A-Za-z_]*|WL_[A-Z_]+|std|esp_[a-z_]+|ESP_[A-Z_]+|WIFI_[A-Z_]+|str[a-z]+|mem[a-z]+)\b/g,
);

// Allocated through nameDB_ after the student's names are claimed (time.ts, ble.ts, espnow.ts,
// math.ts):
// they move out of the student's way instead of being reserved (see RESERVED_WORDS).
const ALLOCATED = /^(?:som_every|som_ble_seen|som_espnow_read|som_espnow_outer_(?:value|from))\d*$/;
const fixedNames = ourNames.filter((name) => !ALLOCATED.test(name));

let workspace: Blockly.Workspace | undefined;

function generate(blocks: BlockState[], variableNames: string[]): string {
  workspace?.dispose();
  workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    {
      blocks: { languageVersion: 0, blocks: blocks.map((b, i) => ({ ...b, x: 0, y: i * 100 })) },
      variables: variableNames.map((name) => ({ name, id: name })),
    },
    workspace,
  );
  return arduinoGenerator.workspaceToCode(workspace);
}

const num = (n: number): BlockState => ({ type: 'math_number', fields: { NUM: n } });
const get = (id: string): BlockState => ({ type: 'variables_get', fields: { VAR: { id } } });
const set = (id: string, value: BlockState): BlockState => ({
  type: 'variables_set',
  fields: { VAR: { id } },
  inputs: { VALUE: { block: value } },
});

beforeAll(() => {
  registerBuiltInFamilies();
  applyLocale('es');
});

afterEach(() => {
  workspace?.dispose();
  workspace = undefined;
  setPinProfile(uno.pins);
  setCurrentChip('avr');
});

describe('generated helper identifiers', () => {
  it('finds the helpers of every family that emits them in the golden sketches', () => {
    expect(fixedNames).toEqual(
      expect.arrayContaining([
        'somWifiConnect',
        'somHttpRequest',
        'somHttpGet',
        'somHttpPost',
        'somBleStart',
        'somBleNotify',
        'somBleReceived',
        'somBleArrived',
        'somBleConnected',
        'somBleLast',
        'SomBleWriteCallbacks',
        'SOM_BLE_SERVICE_UUID',
        'somEspNowBegin',
        'somEspNowSend',
        'somEspNowNext',
        'SomEspNowPacket',
        'SOM_ESPNOW_BROADCAST',
      ]),
    );
    expect(libraryNames).toEqual(
      expect.arrayContaining(['WiFi', 'HTTPClient', 'BLEDevice', 'std', 'esp_now_send', 'strncpy']),
    );
  });

  it('reserves every fixed helper, global and library name', () => {
    const reserved = new Set(RESERVED_WORDS);
    const missing = [...fixedNames, ...libraryNames].filter((name) => !reserved.has(name));
    expect(missing).toEqual([]);
  });

  it('renames a student variable that takes a helper name', () => {
    setPinProfile(esp32c3SuperMini.pins);
    setCurrentChip('esp32c3');
    const names = ['somBleStart', 'somBleLast', 'somHttpGet', 'somWifiConnect', 'std', 'BLEDevice'];
    const code = generate(
      [
        { type: 'som_ble_start', fields: { NAME: 'eco' } },
        ...names.map((name) => set(name, num(1))),
      ],
      names,
    );
    expect(code).toContain('void somBleStart(const char *name) {');
    for (const name of names) expect(code).toContain(`double ${name}2 = 0;`);
  });

  it('moves allocated helpers out of the way of a student variable with their name', () => {
    setPinProfile(esp32c3SuperMini.pins);
    setCurrentChip('esp32c3');
    const code = generate(
      [
        set('som_every', num(1)),
        set('som_ble_seen', num(1)),
        set('randomInt', num(1)),
        { type: 'som_time_every', inputs: { MS: { block: num(100) } } },
        { type: 'som_ble_on_receive' },
        {
          type: 'math_random_int',
          inputs: { FROM: { block: get('randomInt') }, TO: { block: num(6) } },
        },
      ],
      ['som_every', 'som_ble_seen', 'randomInt'],
    );
    for (const name of ['som_every', 'som_ble_seen', 'randomInt']) {
      expect(code).toContain(`double ${name} = 0;`);
    }
    expect(code).toContain('static unsigned long som_every2 = 0;');
    expect(code).toContain('static uint32_t som_ble_seen2 = 0;');
    expect(code).toMatch(/long randomInt2\(double a, double b\) \{/);
  });
});
