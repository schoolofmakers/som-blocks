#include "Provisioning.h"

#include <WiFi.h>

#include <string>
#include <vector>

#include "Console.h"
#include "ImprovBle.h"
#include "Pairing.h"
#include "SerialBridge.h"
#include "config.h"
#include "core/improv_proto.h"
#include "core/logic.h"

// Improv command handling follows the spec pages (improv-wifi.com/serial, /ble) and the
// behaviour the official clients expect (improv-wifi/sdk-serial-js, sdk-ble-js): serial "request
// current state" answers a state frame plus, when provisioned, the URL; a serial scan answers
// one result per network and an empty result at the end; BLE answers a single result with
// SSID/RSSI/auth triples. Credentials are saved only after the board actually joined the
// network, so a typo never replaces working credentials.

namespace som {
namespace provisioning {

namespace {

enum class Origin { Serial, Ble };

struct Attempt {
  bool active = false;
  Origin origin = Origin::Serial;
  String ssid;
  String password;
  uint32_t startMs = 0;
};

struct Scan {
  bool active = false;
  bool forSerial = false;
  bool forBle = false;
};

Attempt attempt;
Scan scan;
WifiLink link(WIFI_CONNECT_TIMEOUT_MS);
improv::SerialParser parser;
std::string rxLine;
bool serialClient = false;  // an Improv client spoke on USB: keep it informed of state changes
uint8_t publishedState = 0xFF;
uint32_t identifyUntilMs = 0;

uint8_t currentState() {
  if (attempt.active) return improv::STATE_PROVISIONING;
  if (WiFi.status() == WL_CONNECTED && pairing::hasCredentials()) return improv::STATE_PROVISIONED;
  return improv::STATE_AUTHORIZED;
}

void sendSerialFrame(uint8_t type, const std::vector<uint8_t> &data) {
  std::vector<uint8_t> frame = improv::buildSerialFrame(type, data);
  console::writeFrame(frame.data(), frame.size());
}

void sendSerialState(uint8_t state) { sendSerialFrame(improv::TYPE_CURRENT_STATE, {state}); }

void sendResult(Origin origin, uint8_t command, const std::vector<std::string> &strings) {
  if (origin == Origin::Ble) {
    std::vector<uint8_t> body = improv::buildRpcResult(command, strings, true);
    uint16_t mtu = improvble::peerMtu();
    if (mtu != 0 && body.size() + 3 > mtu)
      console::log("Improv BLE: MTU %u corta la respuesta de %u bytes", mtu, static_cast<unsigned>(body.size()));
    improvble::sendResult(body);
  } else {
    sendSerialFrame(improv::TYPE_RPC_RESULT, improv::buildRpcResult(command, strings, false));
  }
}

void sendError(Origin origin, uint8_t error) {
  if (origin == Origin::Ble) {
    improvble::setError(error);
  } else {
    sendSerialFrame(improv::TYPE_ERROR_STATE, {error});
  }
}

std::string provisionedUrl() { return std::string(pairing::provisionedUrl().c_str()); }

void publishState(bool force = false) {
  uint8_t state = currentState();
  if (!force && state == publishedState) return;
  publishedState = state;
  improvble::setState(state);
  if (serialClient) sendSerialState(state);
}

void startAttempt(Origin origin, const std::string &ssid, const std::string &password, uint32_t nowMs) {
  attempt.active = true;
  attempt.origin = origin;
  attempt.ssid = ssid.c_str();
  attempt.password = password.c_str();
  attempt.startMs = nowMs;
  WiFi.disconnect(false, false);
  WiFi.begin(attempt.ssid.c_str(), attempt.password.c_str());
  console::log("Improv: probando la red \"%s\"", attempt.ssid.c_str());
  publishState();
}

void startScan(Origin origin) {
  if (origin == Origin::Serial) scan.forSerial = true;
  if (origin == Origin::Ble) scan.forBle = true;
  if (scan.active) return;
  int16_t r = WiFi.scanNetworks(true);  // async: poll WiFi.scanComplete() from loop
  if (r == WIFI_SCAN_FAILED) {
    scan.active = true;  // answered (empty) by finishScan on the next pass
    return;
  }
  scan.active = true;
}

const char *authLabel(wifi_auth_mode_t mode) {
  switch (mode) {
    case WIFI_AUTH_OPEN: return "NO";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA";
    case WIFI_AUTH_WPA2_PSK: return "WPA2";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA/WPA2";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2 EAP";
    case WIFI_AUTH_WPA3_PSK: return "WPA3";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2/WPA3";
    case WIFI_AUTH_WAPI_PSK: return "WAPI";
    default: return "WPA2";
  }
}

void finishScan(int16_t count) {
  std::vector<std::string> bleTriples;
  std::vector<std::string> seen;
  for (int16_t i = 0; i < count; i++) {
    std::string ssid = WiFi.SSID(i).c_str();
    if (ssid.empty()) continue;  // hidden network
    bool dup = false;
    for (const std::string &s : seen) dup = dup || s == ssid;
    if (dup) continue;  // results come strongest first; keep that one
    seen.push_back(ssid);
    std::string rssi = std::to_string(WiFi.RSSI(i));
    wifi_auth_mode_t mode = WiFi.encryptionType(i);
    if (scan.forSerial) {
      sendResult(Origin::Serial, improv::CMD_WIFI_NETWORKS, {ssid, rssi, mode == WIFI_AUTH_OPEN ? "NO" : "YES"});
    }
    bleTriples.push_back(ssid);
    bleTriples.push_back(rssi);
    bleTriples.push_back(authLabel(mode));
  }
  if (scan.forSerial) sendResult(Origin::Serial, improv::CMD_WIFI_NETWORKS, {});
  if (scan.forBle) {
    // One BLE result holds at most 255 data bytes: keep whole triples until it is full.
    std::vector<std::string> fitted;
    size_t used = 0;
    for (size_t i = 0; i + 2 < bleTriples.size(); i += 3) {
      size_t need = 3 + bleTriples[i].size() + bleTriples[i + 1].size() + bleTriples[i + 2].size();
      if (used + need > improv::MAX_DATA) break;
      used += need;
      fitted.insert(fitted.end(), bleTriples.begin() + i, bleTriples.begin() + i + 3);
    }
    sendResult(Origin::Ble, improv::CMD_WIFI_NETWORKS, fitted);
  }
  WiFi.scanDelete();
  scan = Scan();
}

void pollScan() {
  if (!scan.active) return;
  int16_t n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return;
  finishScan(n < 0 ? 0 : n);
}

void handleRpc(Origin origin, const improv::Rpc &rpc, uint32_t nowMs) {
  if (!rpc.ok) {
    sendError(origin, improv::ERROR_INVALID_RPC);
    return;
  }
  if (origin == Origin::Ble) improvble::setError(improv::ERROR_NONE);
  switch (rpc.command) {
    case improv::CMD_WIFI_SETTINGS:
      // 802.11: SSID ≤ 32 bytes; WPA passphrase ≤ 63 characters (64 = raw hex PSK).
      if (rpc.ssid.empty() || rpc.ssid.size() > 32 || rpc.password.size() > 64) {
        sendError(origin, improv::ERROR_INVALID_RPC);
        return;
      }
      startAttempt(origin, rpc.ssid, rpc.password, nowMs);
      return;
    case 0x02:
      if (origin == Origin::Ble) {  // Identify
        identifyUntilMs = nowMs + IDENTIFY_MS;
        return;
      }
      sendSerialState(currentState());  // Request current state
      if (currentState() == improv::STATE_PROVISIONED) {
        sendResult(Origin::Serial, improv::CMD_CURRENT_STATE_SERIAL, {provisionedUrl()});
      }
      return;
    case improv::CMD_DEVICE_INFO:
      sendResult(origin, improv::CMD_DEVICE_INFO,
                 {SOM_FW_NAME, SOM_FW_VERSION, SOM_CHIP_LABEL, pairing::deviceName().c_str()});
      return;
    case improv::CMD_WIFI_NETWORKS:
      if (attempt.active) {  // scanning would disturb the connection attempt
        sendResult(origin, improv::CMD_WIFI_NETWORKS, {});
        return;
      }
      startScan(origin);
      return;
    default:
      sendError(origin, improv::ERROR_UNKNOWN_RPC);
      return;
  }
}

void pollSerial(uint32_t nowMs) {
  // Bounded per pass so a flood on USB cannot hold loop() past its budget.
  for (int i = 0; i < 256 && Serial.available() > 0; i++) {
    int c = Serial.read();
    if (c < 0) break;
    improv::SerialParser::Event event = parser.feed(static_cast<uint8_t>(c));
    if (event == improv::SerialParser::kFrame) {
      serialClient = true;
      if (parser.type() == improv::TYPE_RPC) {
        handleRpc(Origin::Serial, improv::parseRpc(parser.data(), parser.dataLength(), false), nowMs);
      }
    } else if (event == improv::SerialParser::kBadChecksum) {
      serialClient = true;
      sendError(Origin::Serial, improv::ERROR_INVALID_RPC);
    }
    for (char ch : parser.takeText()) {
      if (ch == '\n' || ch == '\r') {
        if (!rxLine.empty()) bridge::enqueue(rxLine);
        rxLine.clear();
      } else if (rxLine.size() < 160) {
        rxLine.push_back(ch);
      }
    }
  }
}

void pollBle(uint32_t nowMs) {
  std::vector<uint8_t> packet;
  improvble::Poll p = improvble::poll(packet, nowMs);
  if (p == improvble::Poll::Invalid) {
    improvble::setError(improv::ERROR_INVALID_RPC);
  } else if (p == improvble::Poll::Packet) {
    handleRpc(Origin::Ble, improv::parseRpc(packet.data(), packet.size(), true), nowMs);
  }
}

void pollAttempt(uint32_t nowMs) {
  if (!attempt.active) return;
  bool joined = WiFi.status() == WL_CONNECTED && WiFi.SSID() == attempt.ssid && nowMs - attempt.startMs > 300;
  if (joined) {
    pairing::saveCredentials(attempt.ssid, attempt.password);
    attempt.active = false;
    attempt.password = "";
    console::log("WiFi conectado a \"%s\" (%s)", attempt.ssid.c_str(), WiFi.localIP().toString().c_str());
    publishState();
    std::string url = provisionedUrl();
    sendResult(attempt.origin, improv::CMD_WIFI_SETTINGS, {url});
    console::localOnly(String("Emparejar: ") + url.c_str());
    return;
  }
  if (nowMs - attempt.startMs > PROVISION_TIMEOUT_MS) {
    console::log("Improv: no se pudo conectar a \"%s\"", attempt.ssid.c_str());
    WiFi.disconnect(false, false);
    Origin origin = attempt.origin;
    attempt = Attempt();
    sendError(origin, improv::ERROR_UNABLE_TO_CONNECT);
    publishState();
  }
}

void stepLink(uint32_t nowMs) {
  bool hasCreds = pairing::hasCredentials();
  WifiLink::Action action = link.step(nowMs, hasCreds, WiFi.status() == WL_CONNECTED, attempt.active);
  if (action == WifiLink::Action::Begin) {
    WiFi.begin(pairing::ssid().c_str(), pairing::password().c_str());
  } else if (action == WifiLink::Action::Disconnect) {
    WiFi.disconnect(false, false);
  }
}

}  // namespace

void begin() {
  improvble::begin(pairing::deviceName());
  publishState(true);
}

void loop(uint32_t nowMs) {
  pollSerial(nowMs);
  pollBle(nowMs);
  pollAttempt(nowMs);
  pollScan();
  stepLink(nowMs);
  publishState();
}

bool attemptActive() { return attempt.active; }

bool identifyActive(uint32_t nowMs) { return static_cast<int32_t>(identifyUntilMs - nowMs) > 0; }

void forget() {
  if (attempt.active) attempt = Attempt();
  pairing::forgetAndRotate();
  WiFi.disconnect(false, true);  // also erase any credentials the WiFi driver kept
  console::log("Placa olvidada: WiFi borrado y token nuevo. Vuelve a conectarla a WiFi.");
}

}  // namespace provisioning
}  // namespace som
