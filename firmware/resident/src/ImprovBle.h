// Improv Wi-Fi over BLE: the GATT service (state, error, RPC command, RPC result, capabilities)
// and the advertisement (service UUID + service data 0x4677 with state and capabilities).
// The NimBLE host task only copies written bytes into a queue; loop() parses and answers, so no
// WiFi work ever runs inside a BLE callback.
//
// Pattern: our C3 ble family (src/blocks/families/ble.ts: BLEDevice::init → createServer →
// createService → createCharacteristic → callbacks → startAdvertising, NimBLE adds 0x2902
// itself) and jnthas/Improv-WiFi-Library src/ImprovWiFiBLE.cpp (MIT; characteristic properties,
// restart advertising on disconnect, service data layout). Written for the core BLE library.
#pragma once

#include <Arduino.h>

#include <vector>

#include "config.h"

namespace som {
namespace improvble {

enum class Poll { None, Packet, Invalid };

void begin(const String &deviceName);
void setState(uint8_t state);
void setError(uint8_t error);
void sendResult(const std::vector<uint8_t> &result);  // RPC result body incl. checksum
Poll poll(std::vector<uint8_t> &packet, uint32_t nowMs);
uint16_t peerMtu();  // 0 when nobody is connected

}  // namespace improvble
}  // namespace som
