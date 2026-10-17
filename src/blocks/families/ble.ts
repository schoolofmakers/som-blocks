import * as Blockly from 'blockly/core';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import { compileError, cppString, stringInput } from '../cpp-types';
import { currentChip } from '../pins';
import type { BlockFamily } from '../types';

// `ble` family (full toolbox only): Bluetooth Low Energy on the ESP32 / ESP32-C3. The C3 has
// no Bluetooth Classic, so there is no Serial-over-Bluetooth here; a phone talks to the board
// with any BLE app (nRF Connect, LightBlue) or a companion app.
//
// What the board exposes, fixed for every sketch so a companion app can find it:
//   service        23a10001-d184-4b51-b408-93dca569d140   (SOM_BLE_SERVICE_UUID)
//   characteristic 23a10002-d184-4b51-b408-93dca569d140   (SOM_BLE_CHARACTERISTIC_UUID)
//                  read + write + notify, value = UTF-8 text
// The phone writes text → `when a message arrives` runs and `message received` holds it. The
// board sends text with `send by Bluetooth` → a notification to every subscribed phone.
//
// Pattern: espressif/arduino-esp32 libraries/BLE/examples/Notify (server + service + one
// characteristic + 0x2902 + advertising) and examples/Write (BLECharacteristicCallbacks::
// onWrite), as shipped in core 3.3.12 on our compile server. Differences:
//   - All of it lives in helpers in the definitions section (`somBleStart`, `somBleNotify`,
//     `somBleReceived`, `somBleArrived`, `somBleConnected`); blocks only call them. There is
//     no "on start" hat, so `somBleStart` runs from loop() and is idempotent.
//   - On the C3 the core uses NimBLE, which adds the 0x2902 descriptor (needed for notify on
//     iOS/Android) by itself and marks the BLE2902 class deprecated. The sketch adds it by
//     hand only under Bluedroid (classic ESP32): `#if defined(CONFIG_BLUEDROID_ENABLED)`.
//   - onWrite runs in the Bluetooth task, not in loop(): it only copies the value into
//     `somBleLast` and counts the write, both under one mutex that loop() also takes to read
//     them. Student blocks never run there; each `when a message arrives` block keeps its own
//     count and fires once in loop() per new write (several writes between two loops fire once; `message received` is the last one).
//   - Notify before a phone subscribes, or before `start Bluetooth`, does nothing.
//   - On disconnect the server callbacks start advertising again, so the phone can reconnect.
//   - The name is cut to 29 bytes (what fits in the scan response) when the code is generated,
//     so the code shows the name the phone will really see.
// Messages longer than the link's MTU (20 bytes before the phone negotiates more) are cut by
// the stack; nRF Connect and most phones negotiate more.
//
// BLE and WiFi together on the C3 are allowed but heavy (they share one radio and most of the
// RAM); no gating, but expect a larger and slower sketch.
//
// Board gating: BLE exists only on ESP32 chips. On AVR (and ESP8266) every block adds one
// translated `#error` (lists-unsupported precedent, cpp-types.ts compileError) and emits no
// BLE includes, so the compile log shows our message instead of a missing header.

const COLOUR = '#1f6fd1';

export const BLE_SERVICE_UUID = '23a10001-d184-4b51-b408-93dca569d140';
export const BLE_CHARACTERISTIC_UUID = '23a10002-d184-4b51-b408-93dca569d140';
/** Longest name (UTF-8 bytes) that fits in the scan response: 31 − 2 header bytes. */
export const BLE_NAME_MAX_BYTES = 29;

const HELPERS = `// Bluetooth (BLE): one service with one text characteristic (read, write, notify).
const char *const SOM_BLE_SERVICE_UUID = "${BLE_SERVICE_UUID}";
const char *const SOM_BLE_CHARACTERISTIC_UUID = "${BLE_CHARACTERISTIC_UUID}";
BLEServer *somBleServer = nullptr;
BLECharacteristic *somBleChar = nullptr;
String somBleLast = "";
uint32_t somBleWrites = 0;  // guarded by somBleLock, like somBleLast
std::mutex somBleLock;

class SomBleServerCallbacks : public BLEServerCallbacks {
  void onDisconnect(BLEServer *server) override {
    BLEDevice::startAdvertising();
  }
};

// Runs in the Bluetooth task: only copy the value and count it; loop() does the rest.
class SomBleWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue();
    std::lock_guard<std::mutex> lock(somBleLock);
    somBleLast = value;
    somBleWrites++;
  }
};

void somBleStart(const char *name) {
  if (somBleServer) return;
  BLEDevice::init(name);
  somBleServer = BLEDevice::createServer();
  somBleServer->setCallbacks(new SomBleServerCallbacks());
  BLEService *service = somBleServer->createService(SOM_BLE_SERVICE_UUID);
  somBleChar = service->createCharacteristic(
    SOM_BLE_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  somBleChar->addDescriptor(new BLE2902());  // NimBLE (C3) adds 0x2902 by itself
#endif
  somBleChar->setCallbacks(new SomBleWriteCallbacks());
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SOM_BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void somBleNotify(const String &value) {
  if (!somBleChar) return;
  somBleChar->setValue(value);
  somBleChar->notify();
}

String somBleReceived() {
  std::lock_guard<std::mutex> lock(somBleLock);
  return somBleLast;
}

bool somBleArrived(uint32_t &seen) {
  std::lock_guard<std::mutex> lock(somBleLock);
  uint32_t writes = somBleWrites;
  if (writes == seen) return false;
  seen = writes;
  return true;
}

bool somBleConnected() {
  return somBleServer && somBleServer->getConnectedCount() > 0;
}`;

/** True when the selected board's chip has BLE. */
function bleSupported(): boolean {
  const chip = currentChip();
  return chip === 'esp32' || chip === 'esp32c3';
}

/**
 * Add the BLE includes and helpers, or, on a board without BLE, the translated `#error`.
 * Returns whether the block may emit BLE code.
 */
function ensureBle(generator: ArduinoGenerator): boolean {
  if (!bleSupported()) {
    compileError(generator, 'ble', Blockly.Msg['SOM_BLE_UNSUPPORTED'] ?? 'BLE');
    return false;
  }
  for (const header of ['BLEDevice.h', 'BLEServer.h', 'BLEUtils.h', 'BLE2902.h', 'mutex']) {
    generator.addInclude(header);
  }
  generator.addDefinition('ble_helpers', HELPERS);
  return true;
}

/** Cut `name` to at most `maxBytes` UTF-8 bytes without splitting a character. */
export function truncateUtf8(name: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let result = '';
  let bytes = 0;
  for (const char of name) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes) break;
    result += char;
    bytes += size;
  }
  return result;
}

const ERROR_LINE = '// ERROR\n';

export const bleFamily: BlockFamily = {
  id: 'ble',
  blocks: [
    {
      type: 'som_ble_start',
      message0: '%{BKY_SOM_BLE_START}',
      args0: [{ type: 'field_input', name: 'NAME', text: '%{BKY_SOM_BLE_START_NAME}' }],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_BLE_START_TOOLTIP}',
    },
    {
      type: 'som_ble_send',
      message0: '%{BKY_SOM_BLE_SEND}',
      args0: [{ type: 'input_value', name: 'VALUE', check: ['Number', 'String'] }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_BLE_SEND_TOOLTIP}',
    },
    {
      type: 'som_ble_on_receive',
      message0: '%{BKY_SOM_BLE_ON_RECEIVE}',
      message1: '%{BKY_SOM_BLE_ON_RECEIVE_DO}',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_BLE_ON_RECEIVE_TOOLTIP}',
    },
    {
      type: 'som_ble_received',
      message0: '%{BKY_SOM_BLE_RECEIVED}',
      output: 'String',
      colour: COLOUR,
      tooltip: '%{BKY_SOM_BLE_RECEIVED_TOOLTIP}',
    },
    {
      type: 'som_ble_connected',
      message0: '%{BKY_SOM_BLE_CONNECTED}',
      output: 'Boolean',
      colour: COLOUR,
      tooltip: '%{BKY_SOM_BLE_CONNECTED_TOOLTIP}',
    },
  ],
  generators: {
    som_ble_start: (block, generator) => {
      if (!ensureBle(generator)) return ERROR_LINE;
      const raw = String(block.getFieldValue('NAME') ?? '').trim();
      const name = truncateUtf8(raw || 'SoM', BLE_NAME_MAX_BYTES);
      return `somBleStart(${cppString(name)});\n`;
    },
    som_ble_send: (block, generator) => {
      if (!ensureBle(generator)) return ERROR_LINE;
      const value = stringInput(block, generator, 'VALUE', Order.NONE) ?? '""';
      return `somBleNotify(${value});\n`;
    },
    som_ble_on_receive: (block, generator) => {
      if (!ensureBle(generator)) return ERROR_LINE;
      if (!generator.nameDB_) throw new Error('ArduinoGenerator used before init()');
      const seen = generator.nameDB_.getDistinctName(
        'som_ble_seen',
        Blockly.Names.NameType.VARIABLE,
      );
      generator.addDefinition(`som_ble_on_receive_${seen}`, `static uint32_t ${seen} = 0;`);
      const body = generator.statementToCode(block, 'DO');
      return `if (somBleArrived(${seen})) {\n${body}}\n`;
    },
    som_ble_received: (_block, generator) => {
      if (!ensureBle(generator)) return ['String()', Order.POSTFIX];
      return ['somBleReceived()', Order.POSTFIX];
    },
    som_ble_connected: (_block, generator) => {
      if (!ensureBle(generator)) return ['false', Order.ATOMIC];
      return ['somBleConnected()', Order.POSTFIX];
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_BLE_CATEGORY}',
    colour: COLOUR,
    fullOnly: true,
    contents: [
      { kind: 'block', type: 'som_ble_start' },
      {
        kind: 'block',
        type: 'som_ble_send',
        inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hola' } } } },
      },
      { kind: 'block', type: 'som_ble_on_receive' },
      { kind: 'block', type: 'som_ble_received' },
      { kind: 'block', type: 'som_ble_connected' },
    ],
  },
  messages: {
    es: {
      SOM_BLE_CATEGORY: 'Bluetooth',
      SOM_BLE_START: 'iniciar Bluetooth con el nombre %1',
      SOM_BLE_START_NAME: 'mi placa',
      SOM_BLE_START_TOOLTIP:
        'Hace que un celular encuentre tu placa con este nombre. Usa un nombre corto y distinto al de tus compañeros. Necesita una placa ESP32.',
      SOM_BLE_SEND: 'enviar por Bluetooth %1',
      SOM_BLE_SEND_TOOLTIP:
        'Envía un texto o número al celular conectado. Si nadie está conectado, no pasa nada. Necesita una placa ESP32.',
      SOM_BLE_ON_RECEIVE: 'cuando llegue un mensaje por Bluetooth',
      SOM_BLE_ON_RECEIVE_DO: 'hacer %1',
      SOM_BLE_ON_RECEIVE_TOOLTIP:
        'Hace estos bloques una vez cada vez que el celular envía un mensaje. Necesita una placa ESP32.',
      SOM_BLE_RECEIVED: 'mensaje recibido por Bluetooth',
      SOM_BLE_RECEIVED_TOOLTIP:
        'El último texto que envió el celular. Vacío si aún no llega nada. Necesita una placa ESP32.',
      SOM_BLE_CONNECTED: 'hay alguien conectado por Bluetooth',
      SOM_BLE_CONNECTED_TOOLTIP:
        'Verdadero si un celular está conectado a tu placa. Necesita una placa ESP32.',
      SOM_BLE_UNSUPPORTED:
        'Bluetooth necesita una placa ESP32, como la ESP32-C3. Elígela en el selector de placa.',
    },
    en: {
      SOM_BLE_CATEGORY: 'Bluetooth',
      SOM_BLE_START: 'start Bluetooth with the name %1',
      SOM_BLE_START_NAME: 'my board',
      SOM_BLE_START_TOOLTIP:
        'Lets a phone find your board by this name. Use a short name that is different from your classmates’. Needs an ESP32 board.',
      SOM_BLE_SEND: 'send by Bluetooth %1',
      SOM_BLE_SEND_TOOLTIP:
        'Sends text or a number to the connected phone. If nobody is connected, nothing happens. Needs an ESP32 board.',
      SOM_BLE_ON_RECEIVE: 'when a message arrives by Bluetooth',
      SOM_BLE_ON_RECEIVE_DO: 'do %1',
      SOM_BLE_ON_RECEIVE_TOOLTIP:
        'Runs these blocks once every time the phone sends a message. Needs an ESP32 board.',
      SOM_BLE_RECEIVED: 'message received by Bluetooth',
      SOM_BLE_RECEIVED_TOOLTIP:
        'The last text the phone sent. Empty until something arrives. Needs an ESP32 board.',
      SOM_BLE_CONNECTED: 'someone is connected by Bluetooth',
      SOM_BLE_CONNECTED_TOOLTIP:
        'True when a phone is connected to your board. Needs an ESP32 board.',
      SOM_BLE_UNSUPPORTED:
        'Bluetooth needs an ESP32 board, like the ESP32-C3. Pick it in the board picker.',
    },
  },
};
