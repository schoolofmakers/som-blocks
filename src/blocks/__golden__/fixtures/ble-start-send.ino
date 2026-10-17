#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <mutex>

// Bluetooth (BLE): one service with one text characteristic (read, write, notify).
const char *const SOM_BLE_SERVICE_UUID = "23a10001-d184-4b51-b408-93dca569d140";
const char *const SOM_BLE_CHARACTERISTIC_UUID = "23a10002-d184-4b51-b408-93dca569d140";
BLEServer *somBleServer = nullptr;
BLECharacteristic *somBleChar = nullptr;
String somBleLast = "";
uint32_t somBleWrites = 0;  // guarded by somBleLock, like somBleLast
std::mutex somBleLock;

class SomBleServerCallbacks : public BLEServerCallbacks {
  void onDisconnect(BLEServer *server) override {
    BLEDevice::startAdvertising();
  }
};

// Runs in the Bluetooth task: only copy the value and count it; loop() does the rest.
class SomBleWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue();
    std::lock_guard<std::mutex> lock(somBleLock);
    somBleLast = value;
    somBleWrites++;
  }
};

void somBleStart(const char *name) {
  if (somBleServer) return;
  BLEDevice::init(name);
  somBleServer = BLEDevice::createServer();
  somBleServer->setCallbacks(new SomBleServerCallbacks());
  BLEService *service = somBleServer->createService(SOM_BLE_SERVICE_UUID);
  somBleChar = service->createCharacteristic(
    SOM_BLE_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  somBleChar->addDescriptor(new BLE2902());  // NimBLE (C3) adds 0x2902 by itself
#endif
  somBleChar->setCallbacks(new SomBleWriteCallbacks());
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SOM_BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void somBleNotify(const String &value) {
  if (!somBleChar) return;
  somBleChar->setValue(value);
  somBleChar->notify();
}

String somBleReceived() {
  std::lock_guard<std::mutex> lock(somBleLock);
  return somBleLast;
}

bool somBleArrived(uint32_t &seen) {
  std::lock_guard<std::mutex> lock(somBleLock);
  uint32_t writes = somBleWrites;
  if (writes == seen) return false;
  seen = writes;
  return true;
}

bool somBleConnected() {
  return somBleServer && somBleServer->getConnectedCount() > 0;
}
static unsigned long som_every = 0;

void setup() {
}

void loop() {
  somBleStart("SoM Ñandú");
  if (millis() - som_every >= 1000) {
    som_every = millis();
    if (somBleConnected()) {
      somBleNotify(String(millis()));
      somBleNotify("hola");
    }
  }
}
