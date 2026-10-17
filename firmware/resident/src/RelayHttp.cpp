#include "RelayHttp.h"

#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>

#include "Pairing.h"
#include "config.h"
#include "core/logic.h"

namespace som {
namespace relay {

static SemaphoreHandle_t limiterLock = xSemaphoreCreateMutex();
static RateLimiter limiter(50);

static void waitForControlToken() {
  for (;;) {
    xSemaphoreTake(limiterLock, portMAX_DELAY);
    uint32_t waitMs = limiter.take(millis());
    xSemaphoreGive(limiterLock);
    if (waitMs == 0) return;
    vTaskDelay(pdMS_TO_TICKS(waitMs));
  }
}

String devicePath(const char *suffix) {
  return String("/v1/devices/") + pairing::deviceId() + "/" + suffix;
}

Response call(const char *method, const String &path, const String &jsonBody, uint32_t timeoutMs, bool control) {
  Response res;
  if (WiFi.status() != WL_CONNECTED) {
    res.code = -1;
    res.detail = "no WiFi";
    return res;
  }
  if (control) waitForControlToken();
  // A TLS handshake needs one contiguous ~40 kB block; failing here is cheaper than a crash.
  if (ESP.getMaxAllocHeap() < MIN_HEAP_FOR_TLS) {
    res.code = ERR_LOW_MEMORY;
    res.detail = String("low memory: ") + ESP.getMaxAllocHeap();
    return res;
  }

  NetworkClientSecure client;
  client.setInsecure();  // classroom trade-off, same as C1: encrypted, server not authenticated
  client.setHandshakeTimeout(15);
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(10000);
  http.setTimeout(static_cast<uint16_t>(timeoutMs > 65000 ? 65000 : timeoutMs));
  if (!http.begin(client, String(SOM_RELAY_URL) + path)) {
    res.code = -2;
    res.detail = "bad relay URL";
    return res;
  }
  http.addHeader("Authorization", String("Bearer ") + pairing::token());
  if (jsonBody.length() > 0) http.addHeader("Content-Type", "application/json");
  const char *keys[] = {"Retry-After"};
  http.collectHeaders(keys, 1);

  res.code = http.sendRequest(method, jsonBody);
  if (res.code > 0) {
    res.retryAfterS = static_cast<uint32_t>(http.header("Retry-After").toInt());
    if (res.code == 200) res.body = http.getString();
  } else {
    res.detail = HTTPClient::errorToString(res.code);
  }
  http.end();
  return res;
}

}  // namespace relay
}  // namespace som
