// Improv Wi-Fi protocol pieces shared by the BLE and serial transports. Header-only, no Arduino
// dependencies, so test/ compiles it with the host c++.
//
// Pattern: improv-wifi/sdk-cpp src/improv.{h,cpp} (Apache-2.0): checksum = low byte of the sum,
// RPC = command, length, data; serial frame = "IMPROV" + version + type + length + data +
// checksum, parsed one byte at a time by position. Written from the spec
// (improv-wifi.com/ble, improv-wifi.com/serial) rather than vendored, because the resident needs
// three things sdk-cpp does not do: bounds-checked parsing of untrusted input (sdk-cpp reads
// data[2] of a WIFI_SETTINGS command before checking the length), non-matching serial bytes
// handed back as text (the USB-CDC port also carries the serial bridge), and BLE writes split
// across several packets. No sdk-cpp code is copied.
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace improv {

static const char *const SERVICE_UUID = "00467768-6228-2272-4663-277478268000";
static const char *const STATE_UUID = "00467768-6228-2272-4663-277478268001";
static const char *const ERROR_UUID = "00467768-6228-2272-4663-277478268002";
static const char *const RPC_COMMAND_UUID = "00467768-6228-2272-4663-277478268003";
static const char *const RPC_RESULT_UUID = "00467768-6228-2272-4663-277478268004";
static const char *const CAPABILITIES_UUID = "00467768-6228-2272-4663-277478268005";

enum State : uint8_t {
  STATE_STOPPED = 0x00,
  STATE_AUTHORIZATION_REQUIRED = 0x01,
  STATE_AUTHORIZED = 0x02,
  STATE_PROVISIONING = 0x03,
  STATE_PROVISIONED = 0x04,
};

enum Error : uint8_t {
  ERROR_NONE = 0x00,
  ERROR_INVALID_RPC = 0x01,
  ERROR_UNKNOWN_RPC = 0x02,
  ERROR_UNABLE_TO_CONNECT = 0x03,
  ERROR_NOT_AUTHORIZED = 0x04,
  ERROR_UNKNOWN = 0xFF,
};

// Command ids. 0x02 means Identify over BLE and Request current state over serial.
enum Command : uint8_t {
  CMD_WIFI_SETTINGS = 0x01,
  CMD_IDENTIFY_BLE = 0x02,
  CMD_CURRENT_STATE_SERIAL = 0x02,
  CMD_DEVICE_INFO = 0x03,
  CMD_WIFI_NETWORKS = 0x04,
};

// BLE capabilities characteristic: identify | device info | scan.
static const uint8_t CAPABILITIES = 0x01 | 0x02 | 0x04;

enum SerialType : uint8_t {
  TYPE_CURRENT_STATE = 0x01,
  TYPE_ERROR_STATE = 0x02,
  TYPE_RPC = 0x03,
  TYPE_RPC_RESULT = 0x04,
};

static const uint8_t SERIAL_VERSION = 1;
static const size_t MAX_DATA = 255;  // one length byte

inline uint8_t checksum(const uint8_t *data, size_t length) {
  uint32_t sum = 0;
  for (size_t i = 0; i < length; i++) sum += data[i];
  return static_cast<uint8_t>(sum & 0xFF);
}

// A parsed RPC: command id plus, for CMD_WIFI_SETTINGS, the credentials.
struct Rpc {
  bool ok = false;  // false = malformed packet (answer ERROR_INVALID_RPC)
  uint8_t command = 0;
  std::string ssid;
  std::string password;
};

// Parses `command, length, data[length]` (plus a trailing checksum when `withChecksum`, as on
// BLE). Every index is bounds-checked: the bytes come from an untrusted client.
inline Rpc parseRpc(const uint8_t *data, size_t length, bool withChecksum) {
  Rpc rpc;
  size_t overhead = 2 + (withChecksum ? 1 : 0);
  if (data == nullptr || length < overhead) return rpc;
  size_t dataLength = data[1];
  if (dataLength + overhead != length) return rpc;
  if (withChecksum && checksum(data, length - 1) != data[length - 1]) return rpc;
  rpc.command = data[0];
  const uint8_t *payload = data + 2;
  if (rpc.command == CMD_WIFI_SETTINGS) {
    if (dataLength < 2) return rpc;
    size_t ssidLength = payload[0];
    if (1 + ssidLength + 1 > dataLength) return rpc;
    size_t passLength = payload[1 + ssidLength];
    if (1 + ssidLength + 1 + passLength != dataLength) return rpc;
    rpc.ssid.assign(reinterpret_cast<const char *>(payload + 1), ssidLength);
    rpc.password.assign(reinterpret_cast<const char *>(payload + 2 + ssidLength), passLength);
  }
  rpc.ok = true;
  return rpc;
}

// RPC result body: command, total length, then (length, bytes) per string. BLE appends a
// checksum; serial does not (the serial frame has its own). Strings that would push the body
// past 255 data bytes are left out, so the result always stays well-formed.
inline std::vector<uint8_t> buildRpcResult(uint8_t command, const std::vector<std::string> &strings,
                                           bool withChecksum) {
  std::vector<uint8_t> out;
  out.push_back(command);
  out.push_back(0);
  for (const std::string &s : strings) {
    size_t used = out.size() - 2;
    if (s.size() > MAX_DATA || used + 1 + s.size() > MAX_DATA) break;
    out.push_back(static_cast<uint8_t>(s.size()));
    out.insert(out.end(), s.begin(), s.end());
  }
  out[1] = static_cast<uint8_t>(out.size() - 2);
  if (withChecksum) out.push_back(checksum(out.data(), out.size()));
  return out;
}

// Whole serial frame: "IMPROV", version, type, length, data, checksum. Data over 255 bytes is
// cut (callers never send that much: the RPC builder caps at 255).
inline std::vector<uint8_t> buildSerialFrame(uint8_t type, const uint8_t *data, size_t length) {
  if (length > MAX_DATA) length = MAX_DATA;
  std::vector<uint8_t> out = {'I', 'M', 'P', 'R', 'O', 'V', SERIAL_VERSION, type,
                              static_cast<uint8_t>(length)};
  out.insert(out.end(), data, data + length);
  out.push_back(checksum(out.data(), out.size()));
  return out;
}

inline std::vector<uint8_t> buildSerialFrame(uint8_t type, const std::vector<uint8_t> &data) {
  return buildSerialFrame(type, data.data(), data.size());
}

// Byte-at-a-time parser for the USB-CDC stream. Bytes that turn out not to be an Improv frame
// are handed back through text() so the serial bridge still sees them.
class SerialParser {
 public:
  enum Event { kNone, kFrame, kBadChecksum };

  Event feed(uint8_t byte) {
    Event event = step(byte);
    if (event == kNone && pos_ == 0 && pendingRetry_) {
      // The byte that broke a partial header may itself start a new frame ('I').
      pendingRetry_ = false;
      event = step(byte);
    }
    return event;
  }

  uint8_t type() const { return buf_[7]; }
  const uint8_t *data() const { return buf_ + 9; }
  size_t dataLength() const { return buf_[8]; }

  // Text collected since the last call (bytes that were not part of a frame).
  std::string takeText() {
    std::string out;
    out.swap(text_);
    return out;
  }

 private:
  static constexpr const char *HEADER = "IMPROV";

  Event step(uint8_t byte) {
    if (pos_ < 6) {
      if (byte == static_cast<uint8_t>(HEADER[pos_])) {
        buf_[pos_++] = byte;
        return kNone;
      }
      flushAsText(byte);
      return kNone;
    }
    if (pos_ == 6 && byte != SERIAL_VERSION) {
      flushAsText(byte);
      return kNone;
    }
    buf_[pos_++] = byte;
    if (pos_ < 9) return kNone;
    size_t total = 9 + static_cast<size_t>(buf_[8]) + 1;
    if (pos_ < total) return kNone;
    pos_ = 0;
    uint8_t expected = checksum(buf_, total - 1);
    return expected == buf_[total - 1] ? kFrame : kBadChecksum;
  }

  // A partial header was ordinary text after all: give it back, then reconsider `byte`.
  void flushAsText(uint8_t byte) {
    if (pos_ > 0) {
      text_.append(reinterpret_cast<const char *>(buf_), pos_);
      pos_ = 0;
      if (byte == 'I') {
        pendingRetry_ = true;
        return;
      }
    }
    text_.push_back(static_cast<char>(byte));
  }

  uint8_t buf_[9 + MAX_DATA + 1] = {};
  size_t pos_ = 0;
  bool pendingRetry_ = false;
  std::string text_;
};

// Reassembles a BLE RPC written in several packets (the spec allows it when the payload is
// over 20 bytes). A packet arriving more than timeoutMs after the previous one starts over.
class BleAssembler {
 public:
  enum Result { kIncomplete, kComplete, kTooLong };

  explicit BleAssembler(uint32_t timeoutMs = 1000) : timeoutMs_(timeoutMs) {}

  Result add(const uint8_t *data, size_t length, uint32_t nowMs) {
    if (!buf_.empty() && nowMs - lastMs_ > timeoutMs_) buf_.clear();
    lastMs_ = nowMs;
    buf_.insert(buf_.end(), data, data + length);
    if (buf_.size() < 2) return kIncomplete;
    size_t expected = static_cast<size_t>(buf_[1]) + 3;
    if (buf_.size() < expected) return kIncomplete;
    if (buf_.size() > expected) {
      buf_.clear();
      return kTooLong;
    }
    return kComplete;
  }

  // The complete packet; clears the assembler.
  std::vector<uint8_t> take() {
    std::vector<uint8_t> out;
    out.swap(buf_);
    return out;
  }

 private:
  std::vector<uint8_t> buf_;
  uint32_t lastMs_ = 0;
  uint32_t timeoutMs_;
};

}  // namespace improv
