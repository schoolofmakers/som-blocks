#include "SerialBridge.h"

#include <vector>

#include "Console.h"
#include "RelayClient.h"
#include "RelayHttp.h"
#include "config.h"
#include "core/logic.h"
#include "core/text.h"

namespace som {
namespace bridge {

static SemaphoreHandle_t lock = nullptr;
static LineQueue *queue = nullptr;
static volatile uint32_t lastOutputMs = 0;
static uint32_t reportedDrops = 0;

void begin() {
  lock = xSemaphoreCreateMutex();
  queue = new LineQueue(48, 160);
}

void enqueue(const std::string &line) {
  if (!lock || !queue || line.empty()) return;
  xSemaphoreTake(lock, portMAX_DELAY);
  queue->push(line);
  xSemaphoreGive(lock);
  lastOutputMs = millis();
}

// Sends one batch from the front of the queue. Lines leave the queue only after a 204, so a
// failed POST is retried with the same lines.
static relay::Response flushBatch() {
  std::string body;
  size_t count = 0;
  xSemaphoreTake(lock, portMAX_DELAY);
  if (queue->dropped() != reportedDrops) {
    char note[64];
    snprintf(note, sizeof(note), "[se perdieron %u lineas]", static_cast<unsigned>(queue->dropped() - reportedDrops));
    reportedDrops = queue->dropped();
    queue->push(note);
  }
  count = buildSerialBatch(*queue, SERIAL_BATCH_LINES, SERIAL_BATCH_BYTES, body);
  xSemaphoreGive(lock);
  relay::Response res;
  if (count == 0) return res;
  res = relay::call("POST", relay::devicePath("serial"), String(body.c_str()), HTTP_TIMEOUT_MS, false);
  if (res.code == 204 || res.code == 200) {
    xSemaphoreTake(lock, portMAX_DELAY);
    queue->popFront(count);
    xSemaphoreGive(lock);
  }
  return res;
}

static bool hasPending() {
  xSemaphoreTake(lock, portMAX_DELAY);
  bool pending = !queue->empty();
  xSemaphoreGive(lock);
  return pending;
}

static relay::Response pollInput() {
  // Long poll while the board is quiet; short polls while it prints, so queued output is not
  // stuck behind a 25 s wait (both stay far below the 60/min control budget).
  bool active = millis() - lastOutputMs < SERIAL_ACTIVE_WINDOW_MS;
  uint32_t waitS = active ? SERIAL_ACTIVE_INPUT_WAIT_S : LONG_POLL_WAIT_S;
  String path = relay::devicePath("input") + "?wait=" + waitS;
  relay::Response res = relay::call("GET", path, "", waitS * 1000 + 10000, true);
  if (res.code == 200) {
    std::vector<std::string> lines;
    if (json::getStringArray(std::string(res.body.c_str()), "lines", lines)) {
      for (const std::string &line : lines) console::writeInput(String(line.c_str()));
    }
  }
  return res;
}

static void task(void *) {
  Backoff backoff(1000, 60000);
  uint32_t lastBatchMs = 0;
  for (;;) {
    if (!relayclient::online() || relayclient::otaActive()) {
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    relay::Response res;
    if (hasPending()) {
      uint32_t since = millis() - lastBatchMs;
      if (since < SERIAL_BATCH_MS) vTaskDelay(pdMS_TO_TICKS(SERIAL_BATCH_MS - since));
      lastBatchMs = millis();
      res = flushBatch();
      if (res.code == 204 || res.code == 200) {
        backoff.reset();
        // Drain a burst before going back to the input poll.
        if (hasPending()) continue;
        res = pollInput();
      }
    } else {
      res = pollInput();
    }
    if (res.code == 200 || res.code == 204) {
      backoff.reset();
    } else {
      if (res.code == 404 || res.code == 401) relayclient::requestRegister();
      vTaskDelay(pdMS_TO_TICKS(backoff.next(res.retryAfterS)));
    }
  }
}

void startTask() { xTaskCreate(task, "som-bridge", 8192, nullptr, 1, nullptr); }

}  // namespace bridge
}  // namespace som
