#include "Console.h"

#include <cstdarg>

#include "SerialBridge.h"

namespace som {
namespace console {

static SemaphoreHandle_t lock = nullptr;

static void withLock(void (*fn)(const void *), const void *arg) {
  if (lock) xSemaphoreTake(lock, portMAX_DELAY);
  fn(arg);
  if (lock) xSemaphoreGive(lock);
}

void begin() {
  lock = xSemaphoreCreateMutex();
  Serial.setTxBufferSize(1024);
  Serial.begin(115200);
  // With no USB host attached, a full TX buffer must not stall the caller (loop budget 50 ms).
  Serial.setTxTimeoutMs(20);
}

void log(const char *fmt, ...) {
  char buf[192];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  withLock([](const void *line) { Serial.println(static_cast<const char *>(line)); }, buf);
  bridge::enqueue(buf);
}

void localOnly(const String &line) {
  withLock([](const void *text) { Serial.println(*static_cast<const String *>(text)); }, &line);
}

void writeFrame(const uint8_t *data, size_t length) {
  struct Frame {
    const uint8_t *data;
    size_t length;
  } frame{data, length};
  withLock(
      [](const void *arg) {
        const Frame *f = static_cast<const Frame *>(arg);
        Serial.write('\n');
        Serial.write(f->data, f->length);
      },
      &frame);
}

void writeInput(const String &line) {
  withLock([](const void *text) { Serial.println(*static_cast<const String *>(text)); }, &line);
}

}  // namespace console
}  // namespace som
