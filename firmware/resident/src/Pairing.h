// Identity and secrets in NVS: device id (base MAC), pairing token (+ the previous one while a
// rotation is pending), WiFi credentials and the build id of an OTA waiting to report `running`.
//
// NVS layout (namespace "som") is a contract with SomLink (D3), which reads the same keys:
//   ssid, pass   WiFi credentials (strings)
//   token        64 hex chars, sha256 stored by the relay
//   prevToken    previous token while the relay has not accepted `token` yet ("" otherwise)
//   otaBuild     buildId of the last OTA written by this board ("" when none pending)
//   otaSlot      label of the partition that OTA went to ("app0"/"app1" in min_spiffs)
// Thread-safe: the loop and the relay task both use it.
#pragma once

#include <Arduino.h>

namespace som {
namespace pairing {

// Loads or creates the token. Call after WiFi.mode(WIFI_STA) so the RNG has RF entropy.
void begin();

String deviceId();    // base MAC, lower-case hex, no separators
String deviceName();  // "SoM-xxxx" (last 4 hex digits of the MAC)
String token();
String provisionedUrl();  // https://<editor>/pair?device=<id>&token=<token>

bool hasCredentials();
String ssid();
String password();
void saveCredentials(const String &ssid, const String &password);

// "Olvidar placa": erase WiFi credentials and generate a new token, keeping the token the relay
// still knows as prevToken.
void forgetAndRotate();

// Token + previous token read together, for one register call.
void registerSnapshot(String &token, String &previous);

// The relay answered 204 to a register that presented `acceptedToken`: drop prevToken, or, if
// "Olvidar placa" rotated the token while that call was in flight, keep `acceptedToken` as the
// previous token (it is what the relay stores now).
void markAccepted(const String &acceptedToken);

void setPendingOta(const String &buildId, const String &slotLabel);
bool pendingOta(String &buildId, String &slotLabel);
void clearPendingOta();

}  // namespace pairing
}  // namespace som
