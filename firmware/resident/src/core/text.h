// Text helpers for the relay protocol: hex, the pairing URL, a minimal JSON writer/reader for
// the few fixed shapes of protocol v1, and the serial line queue. Header-only, no Arduino.
//
// The JSON reader is deliberately tiny (find a top-level key, read a string / number / array of
// strings) instead of pulling ArduinoJson into the compile request: the relay's replies are three
// fixed shapes (`next`, `input`), and anything unexpected is treated as "no data".
#pragma once

#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>

namespace som {

inline std::string toHex(const uint8_t *data, size_t length) {
  static const char *digits = "0123456789abcdef";
  std::string out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 0x0F]);
  }
  return out;
}

inline bool isHex(const std::string &s, size_t length) {
  if (s.size() != length) return false;
  for (char c : s) {
    if (!std::isxdigit(static_cast<unsigned char>(c))) return false;
  }
  return true;
}

inline bool equalsIgnoreCase(const std::string &a, const std::string &b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); i++) {
    if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i])))
      return false;
  }
  return true;
}

// `https://<editor>/pair?device=<deviceId>&token=<token>`; a trailing '/' on the base is dropped.
inline std::string pairUrl(std::string editorBase, const std::string &deviceId, const std::string &token) {
  while (!editorBase.empty() && editorBase.back() == '/') editorBase.pop_back();
  return editorBase + "/pair?device=" + deviceId + "&token=" + token;
}

inline void appendJsonString(std::string &out, const std::string &value) {
  static const char *digits = "0123456789abcdef";
  out.push_back('"');
  for (unsigned char c : value) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          out += "\\u00";
          out.push_back(digits[c >> 4]);
          out.push_back(digits[c & 0x0F]);
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
  out.push_back('"');
}

// Bytes that are not valid UTF-8 would make the relay reject the whole batch; replace them.
inline std::string sanitizeUtf8(const std::string &in) {
  std::string out;
  size_t i = 0;
  while (i < in.size()) {
    unsigned char c = static_cast<unsigned char>(in[i]);
    // Continuation bytes after the lead byte: 0 for ASCII, 1–3 for multi-byte, invalid otherwise.
    size_t extra = 0;
    bool valid = true;
    if (c >= 0x80) {
      if ((c >> 5) == 0x6) {
        extra = 1;
      } else if ((c >> 4) == 0xE) {
        extra = 2;
      } else if ((c >> 3) == 0x1E) {
        extra = 3;
      } else {
        valid = false;
      }
    }
    if (valid && i + extra >= in.size() && extra > 0) valid = false;
    for (size_t k = 1; valid && k <= extra; k++) {
      if ((static_cast<unsigned char>(in[i + k]) >> 6) != 0x2) valid = false;
    }
    if (valid) {
      out.append(in, i, extra + 1);
      i += extra + 1;
    } else {
      out.push_back('?');
      i += 1;
    }
  }
  return out;
}

namespace json {

// Position just after `"key":` (whitespace skipped) at the top level of `body`, or npos.
inline size_t findValue(const std::string &body, const std::string &key) {
  int depth = 0;
  bool inString = false;
  for (size_t i = 0; i < body.size(); i++) {
    char c = body[i];
    if (inString) {
      if (c == '\\') {
        i++;
      } else if (c == '"') {
        inString = false;
      }
      continue;
    }
    if (c == '{' || c == '[') {
      depth++;
    } else if (c == '}' || c == ']') {
      depth--;
    } else if (c == '"') {
      if (depth == 1 && body.compare(i + 1, key.size(), key) == 0 && i + 1 + key.size() < body.size() &&
          body[i + 1 + key.size()] == '"') {
        size_t j = i + 2 + key.size();
        while (j < body.size() && std::isspace(static_cast<unsigned char>(body[j]))) j++;
        if (j < body.size() && body[j] == ':') {
          j++;
          while (j < body.size() && std::isspace(static_cast<unsigned char>(body[j]))) j++;
          return j;
        }
      }
      inString = true;
    }
  }
  return std::string::npos;
}

// Reads a JSON string starting at body[pos] == '"'. Handles the escapes appendJsonString makes
// plus \uXXXX for the BMP (encoded back to UTF-8). Returns false on malformed input.
inline bool readString(const std::string &body, size_t &pos, std::string &out) {
  if (pos >= body.size() || body[pos] != '"') return false;
  out.clear();
  for (size_t i = pos + 1; i < body.size(); i++) {
    char c = body[i];
    if (c == '"') {
      pos = i + 1;
      return true;
    }
    if (c != '\\') {
      out.push_back(c);
      continue;
    }
    if (++i >= body.size()) return false;
    switch (body[i]) {
      case 'n': out.push_back('\n'); break;
      case 'r': out.push_back('\r'); break;
      case 't': out.push_back('\t'); break;
      case 'b': out.push_back('\b'); break;
      case 'f': out.push_back('\f'); break;
      case 'u': {
        if (i + 4 >= body.size()) return false;
        std::string hex = body.substr(i + 1, 4);
        if (!isHex(hex, 4)) return false;
        unsigned long cp = std::strtoul(hex.c_str(), nullptr, 16);
        i += 4;
        if (cp < 0x80) {
          out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
          out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
          out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
          out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
          out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
          out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
        break;
      }
      default: out.push_back(body[i]); break;  // \" \\ \/
    }
  }
  return false;
}

inline bool getString(const std::string &body, const std::string &key, std::string &out) {
  size_t pos = findValue(body, key);
  if (pos == std::string::npos) return false;
  return readString(body, pos, out);
}

// Non-negative integer value (sizes); false when missing, negative, fractional or huge.
inline bool getUint(const std::string &body, const std::string &key, uint32_t &out) {
  size_t pos = findValue(body, key);
  if (pos == std::string::npos || pos >= body.size() || !std::isdigit(static_cast<unsigned char>(body[pos])))
    return false;
  uint64_t value = 0;
  size_t i = pos;
  while (i < body.size() && std::isdigit(static_cast<unsigned char>(body[i]))) {
    value = value * 10 + static_cast<uint64_t>(body[i] - '0');
    if (value > 0xFFFFFFFFull) return false;
    i++;
  }
  if (i < body.size() && (body[i] == '.' || body[i] == 'e' || body[i] == 'E')) return false;
  out = static_cast<uint32_t>(value);
  return true;
}

inline bool getStringArray(const std::string &body, const std::string &key, std::vector<std::string> &out) {
  size_t pos = findValue(body, key);
  if (pos == std::string::npos || pos >= body.size() || body[pos] != '[') return false;
  out.clear();
  size_t i = pos + 1;
  for (;;) {
    while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) i++;
    if (i >= body.size()) return false;
    if (body[i] == ']') return true;
    std::string item;
    if (!readString(body, i, item)) return false;
    out.push_back(item);
    while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) i++;
    if (i < body.size() && body[i] == ',') i++;
  }
}

}  // namespace json

// Fixed-capacity FIFO of serial lines waiting for the relay. When full, the oldest line goes
// and `dropped()` counts it, so a board printing faster than the relay accepts never runs out
// of memory. Not thread-safe: the firmware wraps it in a mutex.
class LineQueue {
 public:
  explicit LineQueue(size_t capacity = 48, size_t maxLineLength = 160)
      : capacity_(capacity), maxLine_(maxLineLength), lines_(capacity) {}

  void push(const std::string &line) {
    std::string clipped = line.size() > maxLine_ ? line.substr(0, maxLine_) : line;
    if (count_ == capacity_) {
      head_ = (head_ + 1) % capacity_;
      count_--;
      dropped_++;
      frontSeq_++;
    }
    lines_[(head_ + count_) % capacity_] = clipped;
    count_++;
  }

  size_t size() const { return count_; }
  bool empty() const { return count_ == 0; }
  uint32_t dropped() const { return dropped_; }
  const std::string &at(size_t i) const { return lines_[(head_ + i) % capacity_]; }

  void popFront(size_t n) {
    if (n > count_) n = count_;
    for (size_t i = 0; i < n; i++) lines_[(head_ + i) % capacity_].clear();
    head_ = (head_ + n) % capacity_;
    count_ -= n;
    frontSeq_ += n;
  }

  // Sequence number of the front line (counts every line that ever left the front). A sender
  // records it before building a batch and acknowledges with ackBefore(seq + sent): lines that
  // arrived meanwhile, or that overflow already dropped, are never removed by mistake.
  uint64_t frontSeq() const { return frontSeq_; }

  void ackBefore(uint64_t seq) {
    if (seq > frontSeq_) popFront(static_cast<size_t>(seq - frontSeq_));
  }

 private:
  size_t capacity_;
  size_t maxLine_;
  std::vector<std::string> lines_;
  size_t head_ = 0;
  size_t count_ = 0;
  uint32_t dropped_ = 0;
  uint64_t frontSeq_ = 0;
};

// `{"lines":[...]}` from the front of `queue`: at most maxLines lines and maxBytes of JSON
// (relay limits: 50 lines / 8 kB). Returns how many lines went in (0 = nothing to send).
inline size_t buildSerialBatch(const LineQueue &queue, size_t maxLines, size_t maxBytes, std::string &out) {
  out = "{\"lines\":[";
  size_t taken = 0;
  for (size_t i = 0; i < queue.size() && taken < maxLines; i++) {
    std::string item;
    appendJsonString(item, sanitizeUtf8(queue.at(i)));
    size_t extra = item.size() + (taken > 0 ? 1 : 0);
    if (out.size() + extra + 2 > maxBytes) break;
    if (taken > 0) out.push_back(',');
    out += item;
    taken++;
  }
  out += "]}";
  return taken;
}

}  // namespace som
