// One HTTPS request to the relay with the bearer token. Shared by the control task (RelayClient)
// and the bridge task; each call opens and closes its own TLS connection, so at most two TLS
// sessions (≈ 40 kB each) exist at once.
//
// Pattern: espressif/arduino-esp32 libraries/HTTPClient + NetworkClientSecure::setInsecure()
// as in our C1 wifi family (src/blocks/families/wifi.ts); Retry-After via collectHeaders().
#pragma once

#include <Arduino.h>

namespace som {
namespace relay {

struct Response {
  int code = 0;              // HTTP status, or < 0 for a transport error (see detail)
  uint32_t retryAfterS = 0;  // from Retry-After on 429/503
  String body;
  String detail;             // short reason when code < 0
};

constexpr int ERR_LOW_MEMORY = -100;

// Control calls (register, next, status, input) share a 50/min budget; `control` makes the call
// wait for a token first (the relay allows 60/min per device).
Response call(const char *method, const String &path, const String &jsonBody, uint32_t timeoutMs, bool control);

String devicePath(const char *suffix);  // "/v1/devices/<id>/<suffix>"

}  // namespace relay
}  // namespace som
