import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  disposeTestWorkspace,
  generate,
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
import { BLE_CHARACTERISTIC_UUID, BLE_NAME_MAX_BYTES, BLE_SERVICE_UUID, truncateUtf8 } from './ble';

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

const start = (name: string): BlockState => ({ type: 'som_ble_start', fields: { NAME: name } });
const send = (value?: BlockState): BlockState => ({
  type: 'som_ble_send',
  ...(value ? { inputs: { VALUE: { block: value } } } : {}),
});
const onReceive = (body?: BlockState): BlockState => ({
  type: 'som_ble_on_receive',
  ...(body ? { inputs: { DO: { block: body } } } : {}),
});
const text = (value: string): BlockState => ({ type: 'text', fields: { TEXT: value } });

describe('ble on the ESP32-C3', () => {
  it('start: includes, helpers with the fixed UUIDs, and an idempotent somBleStart call', () => {
    const code = generate(start('SoM 1'));
    for (const header of ['BLEDevice.h', 'BLEServer.h', 'BLEUtils.h', 'BLE2902.h', 'mutex']) {
      expect(code).toContain(`#include <${header}>`);
    }
    expect(code).toContain(`SOM_BLE_SERVICE_UUID = "${BLE_SERVICE_UUID}";`);
    expect(code).toContain(`SOM_BLE_CHARACTERISTIC_UUID = "${BLE_CHARACTERISTIC_UUID}";`);
    expect(code).toContain('if (somBleServer) return;');
    expect(code).toContain('somBleStart("SoM 1");');
    expect(code).not.toContain('#error');
  });

  it('adds 0x2902 by hand only on Bluedroid (NimBLE on the C3 adds it itself)', () => {
    const code = generate(start('x'));
    expect(code).toContain(
      '#if defined(CONFIG_BLUEDROID_ENABLED)\n  somBleChar->addDescriptor(new BLE2902());',
    );
    expect(code).toContain('BLECharacteristic::PROPERTY_NOTIFY');
  });

  it('re-advertises on disconnect from the server callbacks', () => {
    expect(generate(start('x'))).toContain(
      'void onDisconnect(BLEServer *server) override {\n    BLEDevice::startAdvertising();',
    );
  });

  it('onWrite only copies the value and counts it; no student code runs there', () => {
    const code = generate(onReceive(send(text('hola'))));
    const onWrite = /void onWrite\([^)]*\) override \{([\s\S]*?)\n {2}\}/.exec(code)?.[1] ?? '';
    expect(onWrite).toContain('somBleLast = value;');
    expect(onWrite).not.toContain('somBleNotify');
    // The body runs from loop().
    expect(code).toContain(
      'void loop() {\n  if (somBleArrived(som_ble_seen)) {\n    somBleNotify("hola");',
    );
  });

  it('each `when a message arrives` block keeps its own counter', () => {
    const code = generate(stack(onReceive(), onReceive()));
    expect(code).toContain('static uint32_t som_ble_seen = 0;\nstatic uint32_t som_ble_seen2 = 0;');
    expect(code).toContain('if (somBleArrived(som_ble_seen2)) {');
  });

  it('helpers are emitted once however many blocks use them', () => {
    const code = generate(stack(start('a'), send(num(1)), send(text('b'))));
    expect(code.match(/void somBleStart\(/g)).toHaveLength(1);
    expect(code.match(/#include <BLEDevice.h>/g)).toHaveLength(1);
  });

  it('send: numbers go through String(), text as is, empty sends ""', () => {
    const code = generate(stack(send(num(42)), send(text('hola')), send()));
    expect(code).toContain('somBleNotify(String(42));');
    expect(code).toContain('somBleNotify("hola");');
    expect(code).toContain('somBleNotify("");');
  });

  it('notify is a no-op before start (helper guards the characteristic)', () => {
    expect(generate(send(num(1)))).toContain(
      'void somBleNotify(const String &value) {\n  if (!somBleChar) return;',
    );
  });

  it('received and connected are values', () => {
    const code = generate(
      stack(send({ type: 'som_ble_received' }), {
        type: 'controls_if',
        inputs: { IF0: { block: { type: 'som_ble_connected' } } },
      }),
    );
    expect(code).toContain('somBleNotify(somBleReceived());');
    expect(code).toContain('if (somBleConnected()) {');
    expect(code).toContain('return somBleServer && somBleServer->getConnectedCount() > 0;');
  });

  it('name: escaped, cut to 29 UTF-8 bytes, "SoM" when empty', () => {
    expect(generate(start('a "b"'))).toContain('somBleStart("a \\"b\\"");');
    expect(generate(start('   '))).toContain('somBleStart("SoM");');
    const long = 'ñ'.repeat(20); // 40 bytes
    expect(generate(start(long))).toContain(`somBleStart("${'ñ'.repeat(14)}");`);
  });
});

describe('truncateUtf8', () => {
  it('keeps names that fit and never splits a character', () => {
    expect(truncateUtf8('abc', BLE_NAME_MAX_BYTES)).toBe('abc');
    expect(truncateUtf8('a'.repeat(40), BLE_NAME_MAX_BYTES)).toHaveLength(29);
    expect(truncateUtf8('aaaaaaaaaaaaaaaaaaaaaaaaaaaañ', BLE_NAME_MAX_BYTES)).toBe('a'.repeat(28));
    expect(truncateUtf8('🙂🙂', 5)).toBe('🙂');
  });
});

describe.each<Chip>(['avr', 'esp8266'])('ble on a board without BLE (%s)', (chip) => {
  beforeEach(() => {
    setPinProfile(uno.pins);
    setCurrentChip(chip);
  });

  it('one translated #error, no BLE includes or helpers', () => {
    const code = generate(
      stack(start('x'), send(num(1)), onReceive(send({ type: 'som_ble_received' })), {
        type: 'controls_if',
        inputs: { IF0: { block: { type: 'som_ble_connected' } } },
      }),
    );
    expect(code.match(/#error/g)).toHaveLength(1);
    expect(code).toContain('#error "Bluetooth necesita una placa ESP32');
    expect(code).not.toContain('BLE');
    expect(code).not.toContain('somBle');
    expect(code).toContain('// ERROR');
    expect(code).toContain('if (false) {');
  });

  it('the error follows the language', () => {
    applyLocale('en');
    expect(generate(start('x'))).toContain('#error "Bluetooth needs an ESP32 board');
  });
});
