// SoM resident firmware for the ESP32-C3 SuperMini (_config/architecture.md → Track D).
// Improv Wi-Fi over USB serial and BLE, pairing token, relay register + long poll, OTA into the
// other slot, serial bridge, status LED. Build: firmware/resident/build.sh (our compile server),
// fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs.
//
// Tasks: loop() never blocks (Improv, WiFi link, button, LED); "som-relay" does register /
// next / OTA; "som-bridge" does serial batches / input polls. Both network tasks block on HTTP
// on purpose, away from loop().

#include <WiFi.h>
#include <esp_ota_ops.h>

#include "src/Console.h"
#include "src/Led.h"
#include "src/Pairing.h"
#include "src/Provisioning.h"
#include "src/RelayClient.h"
#include "src/SerialBridge.h"
#include "src/config.h"
#include "src/core/logic.h"

static som::LongPress bootButton(som::FORGET_HOLD_MS);

void setup() {
  som::bridge::begin();  // before anything logs
  som::console::begin();
  pinMode(som::BOOT_PIN, INPUT_PULLUP);
  som::led::begin();

  WiFi.persistent(false);  // credentials live in our NVS namespace, not the driver's
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);  // WifiLink owns reconnects (with backoff)
  WiFi.setSleep(true);           // modem sleep is required when WiFi and BLE share the radio

  som::pairing::begin();  // after WiFi.mode: the token RNG needs the radio on
  uint32_t heapBeforeBle = ESP.getFreeHeap();
  som::provisioning::begin();

  const esp_partition_t *running = esp_ota_get_running_partition();
  som::console::log("%s %s | placa %s (%s) | particion %s | heap libre %u (antes de BLE %u, bloque max %u)",
                    SOM_FW_NAME, SOM_FW_VERSION, som::pairing::deviceName().c_str(),
                    som::pairing::deviceId().c_str(), running ? running->label : "?",
                    static_cast<unsigned>(ESP.getFreeHeap()), static_cast<unsigned>(heapBeforeBle),
                    static_cast<unsigned>(ESP.getMaxAllocHeap()));
  if (som::pairing::hasCredentials()) {
    som::console::localOnly(String("Emparejar: ") + som::pairing::provisionedUrl());
  } else {
    som::console::log("Sin WiFi: conectala con \"Conectar a WiFi\" en el editor (USB o Bluetooth).");
  }

  som::relayclient::startTask();
  som::bridge::startTask();
}

void loop() {
  uint32_t now = millis();
  if (bootButton.update(digitalRead(som::BOOT_PIN) == LOW, now)) som::provisioning::forget();
  som::provisioning::loop(now);
  som::led::show(som::choosePattern({som::relayclient::otaActive(), som::provisioning::identifyActive(now),
                                     WiFi.status() == WL_CONNECTED}),
                 now);
  delay(2);  // yield to the WiFi/BLE tasks; the loop budget is 50 ms
}
