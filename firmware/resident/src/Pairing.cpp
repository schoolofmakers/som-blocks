#include "Pairing.h"

#include <Preferences.h>
#include <esp_mac.h>
#include <esp_random.h>

#include "config.h"
#include "core/logic.h"
#include "core/text.h"

// Pattern: espressif/arduino-esp32 libraries/Preferences/examples (begin(namespace) →
// getString/putString → end()). Values are read once at boot and cached in RAM (the loop asks
// for the credentials every pass); every change writes NVS first, then the cache, under a mutex.

namespace som {
namespace pairing {

static const char *NS = "som";
static SemaphoreHandle_t lock = nullptr;

static String idHex, tokenValue, prevValue, ssidValue, passValue, otaBuildValue, otaSlotValue;

namespace {

struct Guard {
  Guard() { xSemaphoreTake(lock, portMAX_DELAY); }
  ~Guard() { xSemaphoreGive(lock); }
};

String readKey(Preferences &prefs, const char *key) {
  return prefs.isKey(key) ? prefs.getString(key, "") : String();
}

void writeKeys(std::initializer_list<std::pair<const char *, const String *>> entries) {
  Preferences prefs;
  if (!prefs.begin(NS, false)) return;
  for (const auto &e : entries) prefs.putString(e.first, *e.second);
  prefs.end();
}

String newToken() {
  uint8_t raw[32];
  esp_fill_random(raw, sizeof(raw));  // hardware RNG; true random while the radio is on
  std::string hex = toHex(raw, sizeof(raw));
  memset(raw, 0, sizeof(raw));
  return String(hex.c_str());
}

}  // namespace

void begin() {
  lock = xSemaphoreCreateMutex();
  uint8_t mac[6] = {0};
  esp_efuse_mac_get_default(mac);
  idHex = String(toHex(mac, sizeof(mac)).c_str());

  Guard g;
  Preferences prefs;
  if (prefs.begin(NS, true)) {
    tokenValue = readKey(prefs, "token");
    prevValue = readKey(prefs, "prevToken");
    ssidValue = readKey(prefs, "ssid");
    passValue = readKey(prefs, "pass");
    otaBuildValue = readKey(prefs, "otaBuild");
    otaSlotValue = readKey(prefs, "otaSlot");
    prefs.end();
  }
  if (!isHex(std::string(tokenValue.c_str()), 64)) {
    tokenValue = newToken();
    writeKeys({{"token", &tokenValue}});
  }
}

String deviceId() { return idHex; }

String deviceName() { return String("SoM-") + idHex.substring(idHex.length() - 4); }

String token() {
  Guard g;
  return tokenValue;
}

String provisionedUrl() {
  return String(pairUrl(SOM_EDITOR_URL, idHex.c_str(), token().c_str()).c_str());
}

bool hasCredentials() {
  Guard g;
  return ssidValue.length() > 0;
}

String ssid() {
  Guard g;
  return ssidValue;
}

String password() {
  Guard g;
  return passValue;
}

void saveCredentials(const String &ssid, const String &password) {
  Guard g;
  writeKeys({{"ssid", &ssid}, {"pass", &password}});
  ssidValue = ssid;
  passValue = password;
}

void forgetAndRotate() {
  Guard g;
  String empty;
  String prev = String(previousAfterRotation(std::string(tokenValue.c_str()), std::string(prevValue.c_str())).c_str());
  String fresh = newToken();
  // Order matters on power loss: prevToken lands before the new token replaces the old one.
  writeKeys({{"ssid", &empty}, {"pass", &empty}, {"prevToken", &prev}});
  writeKeys({{"token", &fresh}});
  ssidValue = "";
  passValue = "";
  prevValue = prev;
  tokenValue = fresh;
}

void registerSnapshot(String &token, String &previous) {
  Guard g;
  token = tokenValue;
  previous = prevValue;
}

void markAccepted(const String &acceptedToken) {
  Guard g;
  String prev = String(
      previousAfterAccept(std::string(tokenValue.c_str()), std::string(acceptedToken.c_str())).c_str());
  if (prev == prevValue) return;
  writeKeys({{"prevToken", &prev}});
  prevValue = prev;
}

void setPendingOta(const String &buildId, const String &slotLabel) {
  Guard g;
  writeKeys({{"otaBuild", &buildId}, {"otaSlot", &slotLabel}});
  otaBuildValue = buildId;
  otaSlotValue = slotLabel;
}

bool pendingOta(String &buildId, String &slotLabel) {
  Guard g;
  buildId = otaBuildValue;
  slotLabel = otaSlotValue;
  return buildId.length() > 0;
}

void clearPendingOta() {
  Guard g;
  String empty;
  writeKeys({{"otaBuild", &empty}, {"otaSlot", &empty}});
  otaBuildValue = "";
  otaSlotValue = "";
}

}  // namespace pairing
}  // namespace som
