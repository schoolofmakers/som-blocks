// Status LED on GPIO 8 (active-low) driven by LEDC PWM so "breathing" can fade.
#pragma once

#include "core/logic.h"

namespace som {
namespace led {

void begin();
void show(LedPattern pattern, uint32_t nowMs);

}  // namespace led
}  // namespace som
