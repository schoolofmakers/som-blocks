#include "RelayClient.h"

#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Update.h>
#include <WiFi.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>

#include "Console.h"
#include "Pairing.h"
#include "RelayHttp.h"
#include "config.h"
#include "core/logic.h"
#include "core/text.h"

// OTA pattern: espressif/arduino-esp32 libraries/Update/examples/HTTPS_OTA_Update and
// libraries/HTTPUpdate/src/HTTPUpdate.cpp (Content-Length → Update.begin(size) → stream the
// body into Update.write → Update.end(), which validates the image and sets the boot partition).
// Differences: we stream by hand instead of HTTPUpdate::update() so every chunk also feeds a
// sha256 (mbedtls) that is compared with the relay's digest BEFORE Update.end(); on any mismatch
// or error Update.abort() leaves the boot partition untouched, so the running app stays.

namespace som {
namespace relayclient {

static volatile bool isOnline = false;
static volatile bool isOta = false;
static volatile uint32_t gotIpCount = 0;  // bumped on every (re)connection: register again

bool online() { return isOnline; }
bool otaActive() { return isOta; }
void requestRegister() { isOnline = false; }

namespace {

String jsonField(const char *key, const String &value, bool first = false) {
  std::string out = first ? "" : ",";
  appendJsonString(out, key);
  out.push_back(':');
  appendJsonString(out, std::string(value.c_str()));
  return String(out.c_str());
}

// Up to 3 tries. Returns true when the relay has the report (204) or refused it for good (4xx
// other than 429, e.g. 404 unknown_build after the build expired); false when it may still be
// delivered later. During an OTA a lost report is only a silence warning in the editor.
bool postStatus(const String &buildId, const char *state, const String &detail = "") {
  String body = "{" + jsonField("buildId", buildId, true) + jsonField("state", state);
  if (detail.length() > 0) body += jsonField("detail", detail.substring(0, 200));
  body += "}";
  for (int attempt = 0; attempt < 3; attempt++) {
    relay::Response res = relay::call("POST", relay::devicePath("status"), body, HTTP_TIMEOUT_MS, true);
    if (res.code == 204 || res.code == 200) return true;
    if (res.code >= 400 && res.code < 500 && res.code != 429) return true;  // not retryable
    vTaskDelay(pdMS_TO_TICKS(res.retryAfterS > 0 ? res.retryAfterS * 1000 : 1000 * (attempt + 1)));
  }
  return false;
}

// After a reboot: did the OTA we wrote come up? Only this firmware can tell when the new image
// is another resident build; a student sketch reports `running` through SomLink (D3).
// Returns true when nothing is left to report; the NVS keys stay until the relay has the result,
// so a WiFi drop here only delays the report to the next registration.
bool reportPendingOta() {
  String buildId, slot;
  if (!pairing::pendingOta(buildId, slot)) return true;
  const esp_partition_t *running = esp_ota_get_running_partition();
  bool booted = running && slot == running->label;
  bool delivered = booted ? postStatus(buildId, "running")
                          : postStatus(buildId, "failed", "booted the previous app instead of " + slot);
  if (!delivered) return false;
  console::log(booted ? "OTA %s: corriendo" : "OTA %s: la placa volvio al programa anterior", buildId.c_str());
  pairing::clearPendingOta();
  return true;
}

enum class RegisterResult { Ok, Rejected, Retry };

RegisterResult registerDevice(uint32_t &retryAfterS) {
  String token, prev;
  pairing::registerSnapshot(token, prev);
  String body = "{" + jsonField("fw", SOM_FW_NAME "/" SOM_FW_VERSION, true) +
                jsonField("name", pairing::deviceName()) + jsonField("chip", "esp32c3");
  if (prev.length() > 0) body += jsonField("previousToken", prev);
  body += "}";
  relay::Response res = relay::call("POST", relay::devicePath("register"), body, HTTP_TIMEOUT_MS, true, &token);
  retryAfterS = res.retryAfterS;
  if (res.code == 204 || res.code == 200) {
    pairing::markAccepted(token);
    return RegisterResult::Ok;
  }
  if (res.code == 409) return RegisterResult::Rejected;
  console::log("relay register: %d %s", res.code, res.detail.c_str());
  return RegisterResult::Retry;
}

struct Build {
  String id;
  uint32_t size = 0;
  String sha256;
};

// Streams the image into the next OTA slot. Returns "" on success (boot partition switched),
// else the failure detail; the running app is untouched on failure.
String downloadAndFlash(const Build &build) {
  NetworkClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(15);
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(10000);
  http.setTimeout(static_cast<uint16_t>(DOWNLOAD_STALL_MS));
  if (ESP.getMaxAllocHeap() < MIN_HEAP_FOR_TLS) return "low memory before download";
  if (!http.begin(client, String(SOM_RELAY_URL) + "/v1/builds/" + build.id + "/image")) return "bad image URL";
  http.addHeader("Authorization", String("Bearer ") + pairing::token());
  int code = http.GET();
  if (code != 200) {
    http.end();
    // One pending build per device: a newer upload replaced this one (relay README).
    if (code == 404) return "replaced";
    return String("image download HTTP ") + code;
  }
  int length = http.getSize();
  if (length < 0 || static_cast<uint32_t>(length) != build.size) {
    http.end();
    return String("Content-Length ") + length + " != size " + build.size;
  }
  if (!Update.begin(build.size, U_FLASH)) {
    http.end();
    return String("Update.begin: ") + Update.errorString();
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  static uint8_t buf[2048];
  NetworkClient *stream = http.getStreamPtr();
  uint32_t received = 0;
  uint32_t lastDataMs = millis();
  uint32_t nextReport = build.size / 4;
  String error;
  while (received < build.size) {
    size_t avail = stream->available();
    if (avail == 0) {
      if (!http.connected() && stream->available() == 0) {
        error = "connection closed early";
        break;
      }
      if (millis() - lastDataMs > DOWNLOAD_STALL_MS) {
        error = "download stalled";
        break;
      }
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    size_t want = avail;
    if (want > sizeof(buf)) want = sizeof(buf);
    if (want > build.size - received) want = build.size - received;
    int n = stream->read(buf, want);
    if (n <= 0) continue;
    lastDataMs = millis();
    mbedtls_sha256_update(&sha, buf, n);
    if (Update.write(buf, n) != static_cast<size_t>(n)) {
      error = String("Update.write: ") + Update.errorString();
      break;
    }
    received += n;
    if (received >= nextReport && received < build.size) {
      console::log("OTA %u%%", static_cast<unsigned>((uint64_t)received * 100 / build.size));
      nextReport += build.size / 4;
    }
  }
  http.end();

  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (error.length() == 0) {
    std::string got = toHex(digest, sizeof(digest));
    if (!equalsIgnoreCase(got, std::string(build.sha256.c_str()))) error = "sha256 mismatch";
  }
  if (error.length() > 0) {
    Update.abort();
    return error;
  }

  postStatus(build.id, "flashing");
  if (!Update.end()) {  // validates the image, then switches the boot partition
    return String("Update.end: ") + Update.errorString();
  }
  return "";
}

void runOta(const Build &build) {
  isOta = true;
  console::log("OTA %s: %u bytes", build.id.c_str(), static_cast<unsigned>(build.size));
  postStatus(build.id, "downloading");

  const esp_partition_t *slot = esp_ota_get_next_update_partition(nullptr);
  String error;
  if (!slot) {
    error = "no OTA slot (partition table without ota_0/ota_1)";
  } else if (build.size == 0 || build.size > slot->size || build.size > MAX_IMAGE_BYTES) {
    error = String("image of ") + build.size + " bytes does not fit the " + slot->size + " byte slot";
  } else {
    error = downloadAndFlash(build);
  }

  if (error.length() > 0) {
    console::log("OTA %s fallo: %s", build.id.c_str(), error.c_str());
    postStatus(build.id, "failed", error);
    isOta = false;
    return;
  }
  pairing::setPendingOta(build.id, slot->label);
  postStatus(build.id, "rebooting");
  console::log("OTA %s listo, reiniciando", build.id.c_str());
  vTaskDelay(pdMS_TO_TICKS(300));
  ESP.restart();
}

bool parseBuild(const String &body, Build &build) {
  std::string text(body.c_str());
  std::string id, sha;
  uint32_t size = 0;
  if (!json::getString(text, "buildId", id) || id.empty() || id.size() > 64) return false;
  build.id = id.c_str();
  if (!json::getUint(text, "size", size) || !json::getString(text, "sha256", sha) || !isHex(sha, 64)) return false;
  build.size = size;
  build.sha256 = sha.c_str();
  return true;
}

void task(void *) {
  Backoff backoff(1000, 60000);
  bool reportedBoot = false;
  uint32_t seenGotIp = 0;
  for (;;) {
    if (gotIpCount != seenGotIp) {
      seenGotIp = gotIpCount;
      isOnline = false;
    }
    if (WiFi.status() != WL_CONNECTED) {
      isOnline = false;
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    if (!isOnline) {
      uint32_t retryAfterS = 0;
      RegisterResult r = registerDevice(retryAfterS);
      if (r == RegisterResult::Rejected) {
        console::log("El relay rechazo el token de esta placa. Emparejala de nuevo por USB.");
        vTaskDelay(pdMS_TO_TICKS(backoff.next(retryAfterS > 60 ? retryAfterS : 60)));
        continue;
      }
      if (r == RegisterResult::Retry) {
        vTaskDelay(pdMS_TO_TICKS(backoff.next(retryAfterS)));
        continue;
      }
      backoff.reset();
      isOnline = true;
      console::log("Conectada al relay como %s", pairing::deviceId().c_str());
    }

    // Retried every pass (≤ 25 s apart) until the relay has it.
    if (!reportedBoot) reportedBoot = reportPendingOta();

    String path = relay::devicePath("next") + "?wait=" + LONG_POLL_WAIT_S;
    relay::Response res = relay::call("GET", path, "", LONG_POLL_TIMEOUT_MS, true);
    if (res.code == 204) {
      backoff.reset();
      continue;
    }
    if (res.code == 200) {
      backoff.reset();
      Build build;
      if (parseBuild(res.body, build)) {
        runOta(build);
      } else {
        console::log("relay next: respuesta invalida");
        std::string id;
        if (json::getString(std::string(res.body.c_str()), "buildId", id) && !id.empty() && id.size() <= 64)
          postStatus(id.c_str(), "failed", "invalid build descriptor");
      }
      continue;
    }
    if (res.code == 401 || res.code == 404) {
      // 404 unknown_device (relay restart, TTL, DELETE) or 401 (token rotated): register
      // again at once, like server/relay/scripts/fake-device.ts. The rate limiter paces it.
      isOnline = false;
      continue;
    }
    if (res.code < 0) console::log("relay next: %s", res.detail.c_str());
    vTaskDelay(pdMS_TO_TICKS(backoff.next(res.retryAfterS)));
  }
}

}  // namespace

void startTask() {
  WiFi.onEvent([](arduino_event_id_t) { gotIpCount = gotIpCount + 1; }, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  xTaskCreate(task, "som-relay", 8192, nullptr, 1, nullptr);
}

}  // namespace relayclient
}  // namespace som
