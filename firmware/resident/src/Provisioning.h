// Improv Wi-Fi provisioning over serial (USB-CDC) and BLE, plus the WiFi station link that uses
// the stored credentials. Everything runs from loop() and returns at once: WiFi.begin and the
// network scan are asynchronous, and attempts are timed with millis().
#pragma once

#include <Arduino.h>

namespace som {
namespace provisioning {

void begin();
void loop(uint32_t nowMs);

bool attemptActive();               // an Improv "send Wi-Fi settings" is being tried
bool identifyActive(uint32_t nowMs);
void forget();                      // long BOOT press: forget WiFi + rotate the token

}  // namespace provisioning
}  // namespace som
