#include "ImprovBle.h"

#if SOM_IMPROV_BLE

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#include "core/improv_proto.h"

namespace som {
namespace improvble {

namespace {

// One raw GATT write, copied out of the NimBLE task. Writes longer than this are cut and then
// fail the length check, which answers ERROR_INVALID_RPC.
struct Chunk {
  uint16_t length;
  uint8_t data[260];
};

QueueHandle_t chunks = nullptr;
BLECharacteristic *stateChar = nullptr;
BLECharacteristic *errorChar = nullptr;
BLECharacteristic *resultChar = nullptr;
improv::BleAssembler assembler(1000);
uint8_t currentState = improv::STATE_AUTHORIZED;
volatile uint16_t mtu = 0;

void advertise() {
  // Flags + complete 128-bit service UUID + service data (0x4677: state, capabilities, 4 × 0)
  // = 3 + 18 + 10 = 31 bytes, the whole legacy advertisement; the name goes in the scan
  // response. Improv 2.1: UUID and service data must share the primary advertisement.
  static const uint8_t uuidLe[16] = {0x00, 0x80, 0x26, 0x78, 0x74, 0x27, 0x63, 0x46,
                                     0x72, 0x22, 0x28, 0x62, 0x68, 0x77, 0x46, 0x00};
  uint8_t adv[31];
  size_t n = 0;
  adv[n++] = 0x02;
  adv[n++] = 0x01;  // flags
  adv[n++] = 0x06;  // LE general discoverable, BR/EDR not supported
  adv[n++] = 0x11;
  adv[n++] = 0x07;  // complete list of 128-bit service UUIDs
  memcpy(adv + n, uuidLe, sizeof(uuidLe));
  n += sizeof(uuidLe);
  adv[n++] = 0x09;
  adv[n++] = 0x16;  // service data, 16-bit UUID
  adv[n++] = 0x77;
  adv[n++] = 0x46;
  adv[n++] = currentState;
  adv[n++] = improv::CAPABILITIES;
  for (int i = 0; i < 4; i++) adv[n++] = 0x00;

  BLEAdvertisementData data;
  data.addData(reinterpret_cast<char *>(adv), n);
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->setAdvertisementData(data);
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { mtu = 23; }
  void onDisconnect(BLEServer *) override {
    mtu = 0;
    BLEDevice::startAdvertising();
  }
#if defined(CONFIG_NIMBLE_ENABLED)
  void onMtuChanged(BLEServer *, ble_gap_conn_desc *, uint16_t newMtu) override { mtu = newMtu; }
#endif
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    Chunk chunk;
    size_t length = characteristic->getLength();
    chunk.length = static_cast<uint16_t>(length > sizeof(chunk.data) ? sizeof(chunk.data) : length);
    memcpy(chunk.data, characteristic->getData(), chunk.length);
    xQueueSend(chunks, &chunk, 0);  // full queue: drop; the client times out and retries
  }
};

BLECharacteristic *makeChar(BLEService *service, const char *uuid, uint32_t props) {
  return service->createCharacteristic(uuid, props);
}

}  // namespace

void begin(const String &deviceName) {
  chunks = xQueueCreate(4, sizeof(Chunk));
  BLEDevice::init(deviceName);
  BLEDevice::setMTU(517);  // the provisioned URL (~115 B) needs more than the default 23
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(improv::SERVICE_UUID);

  const uint32_t readNotify = BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY;
  stateChar = makeChar(service, improv::STATE_UUID, readNotify);
  errorChar = makeChar(service, improv::ERROR_UUID, readNotify);
  BLECharacteristic *command = makeChar(service, improv::RPC_COMMAND_UUID,
                                        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  resultChar = makeChar(service, improv::RPC_RESULT_UUID, readNotify);
  BLECharacteristic *caps = makeChar(service, improv::CAPABILITIES_UUID, BLECharacteristic::PROPERTY_READ);
  command->setCallbacks(new CommandCallbacks());

  uint8_t zero = 0;
  stateChar->setValue(&currentState, 1);
  errorChar->setValue(&zero, 1);
  resultChar->setValue(&zero, 0);
  uint8_t capabilities = improv::CAPABILITIES;
  caps->setValue(&capabilities, 1);
  service->start();

  BLEAdvertisementData scanResponse;
  scanResponse.setName(deviceName);
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->setScanResponseData(scanResponse);
  advertise();
  BLEDevice::startAdvertising();
}

void setState(uint8_t state) {
  if (state == currentState) return;
  currentState = state;
  stateChar->setValue(&currentState, 1);
  stateChar->notify();
  advertise();
}

void setError(uint8_t error) {
  errorChar->setValue(&error, 1);
  errorChar->notify();
}

void sendResult(const std::vector<uint8_t> &result) {
  resultChar->setValue(const_cast<uint8_t *>(result.data()), result.size());
  resultChar->notify();
}

Poll poll(std::vector<uint8_t> &packet, uint32_t nowMs) {
  Chunk chunk;
  while (xQueueReceive(chunks, &chunk, 0) == pdTRUE) {
    improv::BleAssembler::Result r = assembler.add(chunk.data, chunk.length, nowMs);
    if (r == improv::BleAssembler::kComplete) {
      packet = assembler.take();
      return Poll::Packet;
    }
    if (r == improv::BleAssembler::kTooLong) return Poll::Invalid;
  }
  return Poll::None;
}

uint16_t peerMtu() { return mtu; }

}  // namespace improvble
}  // namespace som

#else  // SOM_IMPROV_BLE == 0: serial-only build

namespace som {
namespace improvble {
void begin(const String &) {}
void setState(uint8_t) {}
void setError(uint8_t) {}
void sendResult(const std::vector<uint8_t> &) {}
Poll poll(std::vector<uint8_t> &, uint32_t) { return Poll::None; }
uint16_t peerMtu() { return 0; }
}  // namespace improvble
}  // namespace som

#endif
