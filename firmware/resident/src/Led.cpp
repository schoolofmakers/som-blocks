#include "Led.h"

#include <Arduino.h>

#include "config.h"

namespace som {
namespace led {

static int lastDuty = -1;

void begin() {
  ledcAttach(LED_PIN, 5000, 8);  // core 3.x LEDC API: pin, frequency, resolution bits
  ledcWrite(LED_PIN, 255);       // active-low: full duty = off
}

void show(LedPattern pattern, uint32_t nowMs) {
  int duty = 255 - ledLevel(pattern, nowMs);
  if (duty == lastDuty) return;
  lastDuty = duty;
  ledcWrite(LED_PIN, duty);
}

}  // namespace led
}  // namespace som
