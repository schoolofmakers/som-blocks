// Host tests for the Arduino-free core of the resident firmware (src/core/*.h).
// Build + run: firmware/resident/test/run.sh (needs only a C++17 compiler).
#include <cstdio>
#include <string>
#include <vector>

#include "../src/core/improv_proto.h"
#include "../src/core/logic.h"
#include "../src/core/text.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                    \
  do {                                                                 \
    checks++;                                                          \
    if (!(cond)) {                                                     \
      failures++;                                                      \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);      \
    }                                                                  \
  } while (0)

using Bytes = std::vector<uint8_t>;

static Bytes bytes(const std::string &s) { return Bytes(s.begin(), s.end()); }

// Client-side encoders, written the way improv-wifi/sdk-ble-js and sdk-serial-js encode them.
static Bytes clientRpc(uint8_t command, const Bytes &data) {
  Bytes out = {command, static_cast<uint8_t>(data.size())};
  out.insert(out.end(), data.begin(), data.end());
  return out;
}

static Bytes wifiData(const std::string &ssid, const std::string &pass) {
  Bytes d = {static_cast<uint8_t>(ssid.size())};
  d.insert(d.end(), ssid.begin(), ssid.end());
  d.push_back(static_cast<uint8_t>(pass.size()));
  d.insert(d.end(), pass.begin(), pass.end());
  return d;
}

static Bytes withChecksum(Bytes b) {
  b.push_back(improv::checksum(b.data(), b.size()));
  return b;
}

static void testChecksumAndRpcParse() {
  // Spec example: 01 1E 0C {MyWirelessAP} 10 {mysecurepassword} CS
  Bytes rpc = withChecksum(clientRpc(0x01, wifiData("MyWirelessAP", "mysecurepassword")));
  CHECK(rpc[1] == 0x1E);
  improv::Rpc parsed = improv::parseRpc(rpc.data(), rpc.size(), true);
  CHECK(parsed.ok);
  CHECK(parsed.command == improv::CMD_WIFI_SETTINGS);
  CHECK(parsed.ssid == "MyWirelessAP");
  CHECK(parsed.password == "mysecurepassword");

  Bytes bad = rpc;
  bad.back() ^= 0xFF;
  CHECK(!improv::parseRpc(bad.data(), bad.size(), true).ok);

  // Length byte lies about the payload.
  Bytes lying = rpc;
  lying[1] = 0x40;
  CHECK(!improv::parseRpc(lying.data(), lying.size(), true).ok);

  // SSID length points past the end (sdk-cpp would read out of bounds here).
  Bytes overrun = withChecksum(clientRpc(0x01, Bytes{0x30, 'a', 'b'}));
  CHECK(!improv::parseRpc(overrun.data(), overrun.size(), true).ok);

  // Password length must close the payload exactly.
  Bytes trailing = wifiData("a", "b");
  trailing.push_back('x');
  Bytes trailingRpc = withChecksum(clientRpc(0x01, trailing));
  CHECK(!improv::parseRpc(trailingRpc.data(), trailingRpc.size(), true).ok);

  // Open network: empty password is fine.
  Bytes open = withChecksum(clientRpc(0x01, wifiData("Sala", "")));
  improv::Rpc openParsed = improv::parseRpc(open.data(), open.size(), true);
  CHECK(openParsed.ok && openParsed.ssid == "Sala" && openParsed.password.empty());

  // Commands without data.
  Bytes info = withChecksum(clientRpc(0x03, {}));
  improv::Rpc infoParsed = improv::parseRpc(info.data(), info.size(), true);
  CHECK(infoParsed.ok && infoParsed.command == improv::CMD_DEVICE_INFO);

  // Too short / null.
  uint8_t one = 0x01;
  CHECK(!improv::parseRpc(&one, 1, true).ok);
  CHECK(!improv::parseRpc(nullptr, 0, false).ok);

  // Serial RPCs carry no inner checksum.
  Bytes serialRpc = clientRpc(0x02, {});
  CHECK(improv::parseRpc(serialRpc.data(), serialRpc.size(), false).ok);
}

static void testRpcResult() {
  Bytes ble = improv::buildRpcResult(0x01, {"https://e/pair?device=a&token=b"}, true);
  CHECK(ble[0] == 0x01);
  CHECK(ble[1] == ble.size() - 3);
  CHECK(ble[2] == 31);
  CHECK(ble.back() == improv::checksum(ble.data(), ble.size() - 1));

  Bytes serial = improv::buildRpcResult(0x03, {"som-resident", "0.1.0", "ESP32-C3", "SoM-ab12"}, false);
  CHECK(serial[1] == serial.size() - 2);
  // Decode it the way sdk-serial-js does.
  std::vector<std::string> decoded;
  size_t idx = 2;
  while (idx < 2u + serial[1]) {
    decoded.emplace_back(serial.begin() + idx + 1, serial.begin() + idx + 1 + serial[idx]);
    idx += serial[idx] + 1;
  }
  CHECK(decoded.size() == 4 && decoded[0] == "som-resident" && decoded[3] == "SoM-ab12");

  // Empty result (end of a serial scan).
  Bytes empty = improv::buildRpcResult(0x04, {}, false);
  CHECK(empty.size() == 2 && empty[1] == 0);

  // Overflow: strings that do not fit in 255 data bytes are left out, never truncated mid-way.
  std::vector<std::string> many(10, std::string(40, 'x'));
  Bytes capped = improv::buildRpcResult(0x04, many, true);
  CHECK(capped[1] <= 255);
  CHECK(capped[1] == 6 * 41);
}

static void testSerialFrames() {
  uint8_t state = improv::STATE_PROVISIONED;
  Bytes frame = improv::buildSerialFrame(improv::TYPE_CURRENT_STATE, &state, 1);
  CHECK(frame.size() == 11);
  CHECK(std::string(frame.begin(), frame.begin() + 6) == "IMPROV");
  CHECK(frame[6] == 1 && frame[7] == 0x01 && frame[8] == 1 && frame[9] == 0x04);
  CHECK(frame[10] == improv::checksum(frame.data(), 10));

  // Parse a client frame (sdk-serial-js appends '\n' after the checksum).
  Bytes rpc = clientRpc(0x01, wifiData("Sala", "clave123"));
  Bytes client = improv::buildSerialFrame(improv::TYPE_RPC, rpc);
  client.push_back('\n');
  improv::SerialParser parser;
  int frames = 0;
  for (uint8_t b : client) {
    if (parser.feed(b) == improv::SerialParser::kFrame) {
      frames++;
      CHECK(parser.type() == improv::TYPE_RPC);
      improv::Rpc parsed = improv::parseRpc(parser.data(), parser.dataLength(), false);
      CHECK(parsed.ok && parsed.ssid == "Sala" && parsed.password == "clave123");
    }
  }
  CHECK(frames == 1);
  CHECK(parser.takeText() == "\n");
}

static void testSerialParserText() {
  improv::SerialParser parser;
  // Plain text, text that starts like the header, then a real frame right after "IMP".
  Bytes rpc = clientRpc(0x03, {});
  Bytes frame = improv::buildSerialFrame(improv::TYPE_RPC, rpc);
  Bytes stream = bytes("hola\nIMPRESORA\nIMP");
  stream.insert(stream.end(), frame.begin(), frame.end());
  stream.push_back('x');
  int frames = 0;
  for (uint8_t b : stream) {
    if (parser.feed(b) == improv::SerialParser::kFrame) frames++;
  }
  CHECK(frames == 1);
  CHECK(parser.takeText() == "hola\nIMPRESORA\nIMPx");
  CHECK(parser.takeText().empty());

  // Wrong version: the header falls back to text.
  improv::SerialParser p2;
  for (uint8_t b : bytes("IMPROV\x02")) p2.feed(b);
  CHECK(p2.takeText() == std::string("IMPROV\x02"));

  // Bad checksum is reported, not delivered.
  Bytes broken = frame;
  broken.back() ^= 0x55;
  improv::SerialParser p3;
  bool sawBad = false;
  for (uint8_t b : broken) {
    if (p3.feed(b) == improv::SerialParser::kBadChecksum) sawBad = true;
  }
  CHECK(sawBad);

  // A parser keeps working after a bad frame.
  int after = 0;
  for (uint8_t b : frame) {
    if (p3.feed(b) == improv::SerialParser::kFrame) after++;
  }
  CHECK(after == 1);
}

static void testBleAssembler() {
  Bytes rpc = withChecksum(clientRpc(0x01, wifiData("RedDelColegio", "una-clave-larga-de-wifi")));
  CHECK(rpc.size() > 20);
  improv::BleAssembler assembler(1000);
  CHECK(assembler.add(rpc.data(), 20, 0) == improv::BleAssembler::kIncomplete);
  CHECK(assembler.add(rpc.data() + 20, rpc.size() - 20, 50) == improv::BleAssembler::kComplete);
  Bytes whole = assembler.take();
  CHECK(whole == rpc);
  CHECK(improv::parseRpc(whole.data(), whole.size(), true).ok);

  // A stale half packet is dropped after the timeout.
  CHECK(assembler.add(rpc.data(), 20, 100) == improv::BleAssembler::kIncomplete);
  Bytes info = withChecksum(clientRpc(0x03, {}));
  CHECK(assembler.add(info.data(), info.size(), 5000) == improv::BleAssembler::kComplete);
  CHECK(assembler.take() == info);

  // More bytes than announced.
  Bytes extra = info;
  extra.push_back(0);
  CHECK(assembler.add(extra.data(), extra.size(), 6000) == improv::BleAssembler::kTooLong);
}

static void testBackoff() {
  som::Backoff b(1000, 60000);
  CHECK(b.next() == 1000);
  CHECK(b.next() == 2000);
  CHECK(b.next() == 4000);
  for (int i = 0; i < 10; i++) b.next();
  CHECK(b.next() == 60000);
  CHECK(b.next(120) == 120000);  // Retry-After wins when longer
  CHECK(b.next(9999) == 300000);  // but is capped at 5 min
  b.reset();
  CHECK(b.next(30) == 30000);
  CHECK(b.next(0) == 2000);
}

static void testRateLimiter() {
  som::RateLimiter r(50);
  uint32_t now = 1000;
  int allowed = 0;
  for (int i = 0; i < 100; i++) {
    if (r.take(now) == 0) allowed++;
  }
  CHECK(allowed == 50);
  uint32_t wait = r.take(now);
  CHECK(wait > 0 && wait <= 1200);
  CHECK(r.take(now + 1200) == 0);  // one token per 1.2 s
  CHECK(r.take(now + 1200) > 0);
  // Over a long run it never exceeds 50 per minute.
  som::RateLimiter r2(50);
  int perMinute = 0;
  for (uint32_t t = 0; t < 120000; t += 100) {
    if (r2.take(t) == 0 && t >= 60000) perMinute++;
  }
  CHECK(perMinute <= 51);
}

static void testLongPress() {
  som::LongPress lp(5000, 30);
  CHECK(!lp.update(true, 0));
  CHECK(!lp.update(true, 4000));
  CHECK(lp.update(true, 5031));
  CHECK(!lp.update(true, 9000));  // fires once per press
  CHECK(!lp.update(false, 9100));
  // Short presses and bounces never fire.
  som::LongPress lp2(5000, 30);
  for (uint32_t t = 0; t < 20000; t += 10) {
    bool pressed = (t / 10) % 2 == 0;  // bouncing every 10 ms
    CHECK(!lp2.update(pressed, t));
  }
}

static void testLed() {
  using som::LedPattern;
  CHECK(som::ledLevel(LedPattern::Breathing, 0) == 0);
  CHECK(som::ledLevel(LedPattern::Breathing, 1000) == 255);
  CHECK(som::ledLevel(LedPattern::Breathing, 500) < som::ledLevel(LedPattern::Breathing, 900));
  CHECK(som::ledLevel(LedPattern::DoubleBlink, 50) == 255);
  CHECK(som::ledLevel(LedPattern::DoubleBlink, 200) == 0);
  CHECK(som::ledLevel(LedPattern::DoubleBlink, 300) == 255);
  CHECK(som::ledLevel(LedPattern::DoubleBlink, 1500) == 0);
  CHECK(som::ledLevel(LedPattern::Fast, 50) == 255 && som::ledLevel(LedPattern::Fast, 150) == 0);
  CHECK(som::ledLevel(LedPattern::Off, 123) == 0);

  CHECK(som::choosePattern({true, true, true}) == LedPattern::Fast);
  CHECK(som::choosePattern({false, true, true}) == LedPattern::Identify);
  CHECK(som::choosePattern({false, false, true}) == LedPattern::DoubleBlink);
  CHECK(som::choosePattern({false, false, false}) == LedPattern::Breathing);
}

static void testWifiLink() {
  using A = som::WifiLink::Action;
  using S = som::WifiLink::State;
  som::WifiLink link(15000);
  CHECK(link.step(0, false, false, false) == A::None);
  CHECK(link.state() == S::Idle);
  CHECK(link.step(100, true, false, false) == A::Begin);
  CHECK(link.step(5000, true, false, false) == A::None);
  CHECK(link.step(15100, true, false, false) == A::Disconnect);  // timed out
  CHECK(link.state() == S::Waiting);
  CHECK(link.step(16000, true, false, false) == A::None);  // backoff 2 s
  CHECK(link.step(17200, true, false, false) == A::Begin);
  CHECK(link.step(18000, true, true, false) == A::None);
  CHECK(link.state() == S::Connected);
  CHECK(link.step(30000, true, false, false) == A::Begin);  // dropped: reconnect at once
  // Provisioning owns the radio: no actions.
  CHECK(link.step(31000, true, false, true) == A::None);
  // Credentials forgotten while connecting: disconnect once, then idle.
  CHECK(link.step(32000, true, false, false) == A::Begin);
  CHECK(link.step(33000, false, false, false) == A::Disconnect);
  CHECK(link.step(34000, false, false, false) == A::None);
  // Backoff grows: second timeout waits 4 s.
  som::WifiLink l2(1000);
  l2.step(0, true, false, false);
  l2.step(1000, true, false, false);  // timeout 1 → wait 2 s
  CHECK(l2.step(3000, true, false, false) == A::Begin);
  CHECK(l2.step(4000, true, false, false) == A::Disconnect);  // timeout 2 → wait 4 s
  CHECK(l2.step(7900, true, false, false) == A::None);
  CHECK(l2.step(8000, true, false, false) == A::Begin);
}

static void testTokenRotation() {
  std::string none;
  CHECK(som::previousAfterRotation(std::string("A"), none) == "A");
  // Second rotation before the relay accepted the first: keep the token the relay still has.
  CHECK(som::previousAfterRotation(std::string("B"), std::string("A")) == "A");
}

static void testText() {
  uint8_t mac[6] = {0x34, 0x85, 0x18, 0x0a, 0xbc, 0xde};
  CHECK(som::toHex(mac, 6) == "3485180abcde");
  CHECK(som::pairUrl("https://blocks.example/", "3485180abcde", "ff00") ==
        "https://blocks.example/pair?device=3485180abcde&token=ff00");
  CHECK(som::isHex(std::string(64, 'a'), 64));
  CHECK(!som::isHex(std::string(63, 'a'), 64));
  CHECK(!som::isHex(std::string(64, 'g'), 64));
  CHECK(som::equalsIgnoreCase("ABCdef", "abcDEF"));
  CHECK(!som::equalsIgnoreCase("abc", "abd"));

  std::string s;
  som::appendJsonString(s, "a\"b\\c\nd\x01");
  CHECK(s == "\"a\\\"b\\\\c\\nd\\u0001\"");
  CHECK(som::sanitizeUtf8("añb") == "añb");
  CHECK(som::sanitizeUtf8(std::string("a\xff" "b")) == "a?b");
  CHECK(som::sanitizeUtf8(std::string("a\xc3")) == "a?");  // cut multi-byte at the end
}

static void testJsonReader() {
  std::string next = R"({ "buildId" : "b-123", "size": 1048576, "sha256":"ABCDEF", "nested": {"size": 1}})";
  std::string id;
  uint32_t size = 0;
  CHECK(som::json::getString(next, "buildId", id) && id == "b-123");
  CHECK(som::json::getUint(next, "size", size) && size == 1048576);
  std::string sha;
  CHECK(som::json::getString(next, "sha256", sha) && sha == "ABCDEF");
  CHECK(!som::json::getString(next, "missing", sha));

  // Keys inside nested objects or string values are not top-level matches.
  std::string tricky = R"({"note":"\"size\": 9","inner":{"size":7},"size":42})";
  CHECK(som::json::getUint(tricky, "size", size) && size == 42);

  CHECK(!som::json::getUint(R"({"size":-1})", "size", size));
  CHECK(!som::json::getUint(R"({"size":1.5})", "size", size));
  CHECK(!som::json::getUint(R"({"size":99999999999})", "size", size));

  std::vector<std::string> lines;
  CHECK(som::json::getStringArray(R"({"lines":["hola","a\"b","ñ", "x\ny"]})", "lines", lines));
  CHECK(lines.size() == 4 && lines[0] == "hola" && lines[1] == "a\"b" && lines[2] == "ñ" && lines[3] == "x\ny");
  CHECK(som::json::getStringArray(R"({"lines":[]})", "lines", lines) && lines.empty());
  CHECK(!som::json::getStringArray(R"({"lines":["open)", "lines", lines));
  CHECK(!som::json::getStringArray(R"({"lines":"x"})", "lines", lines));
}

static void testLineQueueAndBatch() {
  som::LineQueue q(4, 10);
  q.push("uno");
  q.push("dos");
  q.push("una línea muy larga que se corta");
  CHECK(q.size() == 3);
  CHECK(q.at(2).size() == 10);
  q.push("cuatro");
  q.push("cinco");  // drops "uno"
  CHECK(q.size() == 4 && q.dropped() == 1 && q.at(0) == "dos");

  std::string body;
  size_t n = som::buildSerialBatch(q, 2, 8000, body);
  CHECK(n == 2);
  CHECK(body.rfind("{\"lines\":[\"dos\",", 0) == 0);
  q.popFront(n);
  CHECK(q.size() == 2 && q.at(0) == "cuatro");

  // Byte cap: stops before going over.
  som::LineQueue big(60, 200);
  for (int i = 0; i < 60; i++) big.push(std::string(150, 'x'));
  n = som::buildSerialBatch(big, 50, 8192, body);
  CHECK(n == 50);
  n = som::buildSerialBatch(big, 50, 1000, body);
  CHECK(n > 0 && n < 50 && body.size() <= 1000);
  std::vector<std::string> back;
  CHECK(som::json::getStringArray(body, "lines", back) && back.size() == n);

  som::LineQueue emptyQ;
  CHECK(som::buildSerialBatch(emptyQ, 50, 8192, body) == 0);
}

int main() {
  testChecksumAndRpcParse();
  testRpcResult();
  testSerialFrames();
  testSerialParserText();
  testBleAssembler();
  testBackoff();
  testRateLimiter();
  testLongPress();
  testLed();
  testWifiLink();
  testTokenRotation();
  testText();
  testJsonReader();
  testLineQueueAndBatch();
  std::printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
