// Relay protocol v1, device side (_config/architecture.md → Track D → Relay service): register
// (with previousToken after a rotation), long-poll `next`, download the build into the other OTA
// slot with size + sha256 checks, report `status`, reboot. Runs in its own FreeRTOS task.
#pragma once

#include <Arduino.h>

namespace som {
namespace relayclient {

void startTask();

bool online();     // registered with the relay on the current WiFi connection
bool otaActive();  // downloading / flashing an image

// Another task got `404 unknown_device` or `401` (record gone after a relay restart, TTL or
// DELETE; token rotated): register again before the next call.
void requestRegister();

}  // namespace relayclient
}  // namespace som
