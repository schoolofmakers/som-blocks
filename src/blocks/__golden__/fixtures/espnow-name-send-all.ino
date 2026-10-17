#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <mutex>

// ESP-NOW: messages by name, sent to everyone (broadcast) on channel 1, unencrypted.
// Packet: who sends it, who it is for ("*" = everyone) and the value, all as text.
struct SomEspNowPacket {
  char from[16];
  char to[16];
  char value[200];
};
static_assert(sizeof(SomEspNowPacket) <= ESP_NOW_MAX_DATA_LEN, "ESP-NOW sends at most 250 bytes");
const uint8_t SOM_ESPNOW_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
const uint8_t SOM_ESPNOW_CHANNEL = 1;
const uint32_t SOM_ESPNOW_QUEUE_SIZE = 8;  // a power of two, so the index survives wrap-around
SomEspNowPacket somEspNowQueue[SOM_ESPNOW_QUEUE_SIZE];
uint32_t somEspNowWritten = 0;     // packets queued since boot
uint32_t somEspNowDropped = 0;     // skipped by a hat that fell behind (not shown in v1)
uint32_t somEspNowSendFailed = 0;  // informational: broadcast has no acknowledgement
char somEspNowMe[16] = "";
std::mutex somEspNowLock;          // guards everything above, shared with the WiFi task
bool somEspNowReady = false;
String somEspNowValue = "";        // the message a "when a message arrives" block is handling
String somEspNowFrom = "";

// Copy text into a fixed field, always null-terminated. Text too long is cut before the
// UTF-8 character that would not fit (like names typed in blocks), never in its middle.
void somEspNowCopy(char *field, size_t size, const char *text) {
  size_t end = size - 1;
  strncpy(field, text, end);
  if (strnlen(text, size) > end) {
    while (end > 0 && ((uint8_t)text[end] & 0xC0) == 0x80) end--;
  }
  field[end] = '\0';
}

// Runs in the WiFi task: keep the packet if it is for me or for everyone, then return.
void somEspNowOnRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != (int)sizeof(SomEspNowPacket)) return;  // not a som-blocks message
  SomEspNowPacket packet;
  memcpy(&packet, data, sizeof(packet));
  packet.from[sizeof(packet.from) - 1] = '\0';
  packet.to[sizeof(packet.to) - 1] = '\0';
  packet.value[sizeof(packet.value) - 1] = '\0';
  std::lock_guard<std::mutex> lock(somEspNowLock);
  if (strcmp(packet.to, "*") != 0 && strcmp(packet.to, somEspNowMe) != 0) return;
  somEspNowQueue[somEspNowWritten % SOM_ESPNOW_QUEUE_SIZE] = packet;
  somEspNowWritten++;
}

// Runs in the WiFi task. The signature changed in ESP-IDF 5.5 (esp32 core 3.3).
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
void somEspNowOnSent(const esp_now_send_info_t *info, esp_now_send_status_t status) {
#else
void somEspNowOnSent(const uint8_t *mac, esp_now_send_status_t status) {
#endif
  if (status == ESP_NOW_SEND_SUCCESS) return;
  std::lock_guard<std::mutex> lock(somEspNowLock);
  somEspNowSendFailed++;
}

// Start ESP-NOW the first time; afterwards only change the name. Safe to call every loop.
void somEspNowBegin(const char *name) {
  {
    std::lock_guard<std::mutex> lock(somEspNowLock);
    somEspNowCopy(somEspNowMe, sizeof(somEspNowMe), name);
  }
  if (somEspNowReady) return;
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(SOM_ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) return;
  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, SOM_ESPNOW_BROADCAST, sizeof(SOM_ESPNOW_BROADCAST));
  peer.channel = SOM_ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    esp_now_deinit();  // try again on the next call
    return;
  }
  esp_now_register_recv_cb(somEspNowOnRecv);
  esp_now_register_send_cb(somEspNowOnSent);
  somEspNowReady = true;
}

// Send value to the board called "to" ("*" = everyone). Returns before anyone receives it.
void somEspNowSend(const String &to, const String &value) {
  if (!somEspNowReady) return;
  SomEspNowPacket packet;
  memset(&packet, 0, sizeof(packet));
  {
    std::lock_guard<std::mutex> lock(somEspNowLock);
    somEspNowCopy(packet.from, sizeof(packet.from), somEspNowMe);
  }
  somEspNowCopy(packet.to, sizeof(packet.to), to.c_str());
  somEspNowCopy(packet.value, sizeof(packet.value), value.c_str());
  esp_now_send(SOM_ESPNOW_BROADCAST, (const uint8_t *)&packet, sizeof(packet));
}

// The next queued message for one "when a message arrives" block (from = nullptr: anyone).
// read is that block's own position; one that fell behind skips the oldest messages.
bool somEspNowNext(uint32_t &read, const char *from) {
  std::lock_guard<std::mutex> lock(somEspNowLock);
  if (somEspNowWritten - read > SOM_ESPNOW_QUEUE_SIZE) {
    somEspNowDropped += somEspNowWritten - read - SOM_ESPNOW_QUEUE_SIZE;
    read = somEspNowWritten - SOM_ESPNOW_QUEUE_SIZE;
  }
  while (read != somEspNowWritten) {
    const SomEspNowPacket &packet = somEspNowQueue[read % SOM_ESPNOW_QUEUE_SIZE];
    read++;
    if (from && strcmp(packet.from, from) != 0) continue;
    somEspNowValue = packet.value;
    somEspNowFrom = packet.from;
    return true;
  }
  return false;
}
static unsigned long som_every = 0;

void setup() {
}

void loop() {
  somEspNowBegin("placa1");
  if (millis() - som_every >= 1000) {
    som_every = millis();
    somEspNowSend("*", "hola");
    somEspNowSend("*", String(millis()));
  }
}
