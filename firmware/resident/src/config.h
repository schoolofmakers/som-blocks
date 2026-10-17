// Build-time settings of the resident firmware. build.sh rewrites the two URL defaults when
// SOM_EDITOR_URL / SOM_RELAY_URL are set in its environment (the compile server API takes no
// -D flags), so these lines must keep their exact `#define NAME "value"` shape.
#pragma once

#include <cstddef>
#include <cstdint>

#ifndef SOM_EDITOR_URL
#define SOM_EDITOR_URL "https://blocks.schoolofmakers.cl"
#endif

#ifndef SOM_RELAY_URL
#define SOM_RELAY_URL "https://som-relay.fly.dev"
#endif

// 1 = Improv over BLE and serial; 0 = serial only (saves ~110 kB of flash, see README).
#ifndef SOM_IMPROV_BLE
#define SOM_IMPROV_BLE 1
#endif

#define SOM_FW_NAME "som-resident"
#define SOM_FW_VERSION "0.1.0"
#define SOM_CHIP_LABEL "ESP32-C3"

namespace som {

constexpr int LED_PIN = 8;          // SuperMini blue LED, active-low (_config/boards.md)
constexpr int BOOT_PIN = 9;         // BOOT button, low when pressed
constexpr uint32_t FORGET_HOLD_MS = 5000;

constexpr uint32_t PROVISION_TIMEOUT_MS = 20000;  // Improv "send Wi-Fi settings" attempt
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t IDENTIFY_MS = 5000;

constexpr uint32_t LONG_POLL_WAIT_S = 25;                // `next?wait=` / `input?wait=`
constexpr uint32_t LONG_POLL_TIMEOUT_MS = 35000;         // HTTP read timeout for a long poll
constexpr uint32_t HTTP_TIMEOUT_MS = 10000;              // every other call
constexpr uint32_t DOWNLOAD_STALL_MS = 15000;            // no image bytes for this long = failed
constexpr uint32_t MAX_IMAGE_BYTES = 2u * 1024u * 1024u; // relay limit
constexpr uint32_t MIN_HEAP_FOR_TLS = 45000;             // largest free block needed to open TLS

constexpr size_t SERIAL_BATCH_LINES = 50;   // relay limit per batch
constexpr size_t SERIAL_BATCH_BYTES = 8000; // relay limit is 8 kB
constexpr uint32_t SERIAL_BATCH_MS = 500;
constexpr uint32_t SERIAL_ACTIVE_WINDOW_MS = 30000;  // recent output → short input polls
constexpr uint32_t SERIAL_ACTIVE_INPUT_WAIT_S = 2;

}  // namespace som
