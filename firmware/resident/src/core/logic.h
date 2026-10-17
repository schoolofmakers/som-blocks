// Timing and state logic of the resident firmware, kept free of Arduino so test/ can run it on
// the host. Every function takes the current time in milliseconds; nothing here sleeps.
#pragma once

#include <cstdint>

namespace som {

// Exponential backoff for relay errors: 1 s, 2 s, 4 s … capped at maxMs. A relay
// `Retry-After` wins when it asks for longer (itself capped at 5 min).
class Backoff {
 public:
  explicit Backoff(uint32_t baseMs = 1000, uint32_t maxMs = 60000) : baseMs_(baseMs), maxMs_(maxMs) {}

  uint32_t next(uint32_t retryAfterS = 0) {
    uint32_t delay = baseMs_;
    for (uint32_t i = 0; i < failures_ && delay < maxMs_; i++) delay *= 2;
    if (delay > maxMs_) delay = maxMs_;
    if (failures_ < 31) failures_++;
    uint32_t asked = retryAfterS > 300 ? 300000 : retryAfterS * 1000;
    return asked > delay ? asked : delay;
  }

  void reset() { failures_ = 0; }
  uint32_t failures() const { return failures_; }

 private:
  uint32_t baseMs_;
  uint32_t maxMs_;
  uint32_t failures_ = 0;
};

// Token bucket shared by the control calls (register, next, status, input), which the relay
// limits to 60/min per device. We stay below that with `capacity` per minute.
class RateLimiter {
 public:
  explicit RateLimiter(uint32_t perMinute = 50) : capacity_(perMinute), tokens_(perMinute) {}

  // Takes one token if available. Returns 0 on success, else ms until the next token.
  uint32_t take(uint32_t nowMs) {
    refill(nowMs);
    if (tokens_ >= 1) {
      tokens_ -= 1;
      return 0;
    }
    uint32_t perTokenMs = 60000 / capacity_;
    uint32_t sinceMs = nowMs - lastMs_;
    return sinceMs >= perTokenMs ? 1 : perTokenMs - sinceMs;
  }

 private:
  void refill(uint32_t nowMs) {
    if (!started_) {
      started_ = true;
      lastMs_ = nowMs;
      return;
    }
    uint32_t perTokenMs = 60000 / capacity_;
    uint32_t elapsed = nowMs - lastMs_;
    uint32_t add = elapsed / perTokenMs;
    if (add == 0) return;
    tokens_ = tokens_ + add > capacity_ ? capacity_ : tokens_ + add;
    lastMs_ += add * perTokenMs;
  }

  uint32_t capacity_;
  uint32_t tokens_;
  uint32_t lastMs_ = 0;
  bool started_ = false;
};

// BOOT button: fires once when held for holdMs, after a debounce. `pressed` is the raw level
// already translated (true = button down).
class LongPress {
 public:
  explicit LongPress(uint32_t holdMs = 5000, uint32_t debounceMs = 30) : holdMs_(holdMs), debounceMs_(debounceMs) {}

  bool update(bool pressed, uint32_t nowMs) {
    if (pressed != raw_) {
      raw_ = pressed;
      changedMs_ = nowMs;
    }
    if (nowMs - changedMs_ < debounceMs_) return false;
    if (stable_ != raw_) {
      stable_ = raw_;
      downSinceMs_ = changedMs_;  // the hold counts from the edge, not from when we noticed it
      fired_ = false;
    }
    if (stable_ && !fired_ && nowMs - downSinceMs_ >= holdMs_) {
      fired_ = true;
      return true;
    }
    return false;
  }

  bool held() const { return stable_; }

 private:
  uint32_t holdMs_;
  uint32_t debounceMs_;
  bool raw_ = false;
  bool stable_ = false;
  bool fired_ = false;
  uint32_t changedMs_ = 0;
  uint32_t downSinceMs_ = 0;
};

// LED patterns from _config/architecture.md → Track D (plus Improv identify).
enum class LedPattern { Off, Breathing, DoubleBlink, Fast, Identify };

// Brightness 0..255 for `pattern` at time `ms` (active-low inversion is the driver's job).
inline uint8_t ledLevel(LedPattern pattern, uint32_t ms) {
  switch (pattern) {
    case LedPattern::Breathing: {
      // 2 s triangle, squared so it reads as a smooth breath.
      uint32_t t = ms % 2000;
      uint32_t ramp = t < 1000 ? t : 2000 - t;  // 0..1000
      return static_cast<uint8_t>((ramp * ramp * 255) / 1000000);
    }
    case LedPattern::DoubleBlink: {
      uint32_t t = ms % 2000;
      return (t < 100 || (t >= 250 && t < 350)) ? 255 : 0;
    }
    case LedPattern::Fast:
      return (ms % 200) < 100 ? 255 : 0;
    case LedPattern::Identify:
      return (ms % 1000) < 500 ? 255 : 0;
    case LedPattern::Off:
    default:
      return 0;
  }
}

struct LedInputs {
  bool otaActive;
  bool identifyActive;
  bool wifiConnected;
};

inline LedPattern choosePattern(const LedInputs &in) {
  if (in.otaActive) return LedPattern::Fast;
  if (in.identifyActive) return LedPattern::Identify;
  if (in.wifiConnected) return LedPattern::DoubleBlink;
  return LedPattern::Breathing;
}

// WiFi station link with stored credentials: start a connection, give it connectTimeoutMs,
// then wait with exponential backoff before retrying. The firmware runs this from loop()
// (WiFi.begin is asynchronous), so it never blocks.
class WifiLink {
 public:
  enum class State { Idle, Connecting, Connected, Waiting };
  enum class Action { None, Begin, Disconnect };

  explicit WifiLink(uint32_t connectTimeoutMs = 15000) : timeoutMs_(connectTimeoutMs), backoff_(2000, 60000) {}

  // hasCredentials: credentials stored; connected: WiFi.status() == WL_CONNECTED;
  // suspended: an Improv provisioning attempt owns the radio right now.
  Action step(uint32_t nowMs, bool hasCredentials, bool connected, bool suspended) {
    if (suspended) {
      state_ = connected ? State::Connected : State::Idle;
      return Action::None;
    }
    if (!hasCredentials) {
      bool wasActive = state_ == State::Connecting || state_ == State::Connected;
      state_ = State::Idle;
      backoff_.reset();
      return wasActive ? Action::Disconnect : Action::None;
    }
    if (connected) {
      state_ = State::Connected;
      backoff_.reset();
      return Action::None;
    }
    switch (state_) {
      case State::Idle:
      case State::Connected:  // link dropped: reconnect at once
        state_ = State::Connecting;
        sinceMs_ = nowMs;
        return Action::Begin;
      case State::Connecting:
        if (nowMs - sinceMs_ < timeoutMs_) return Action::None;
        state_ = State::Waiting;
        sinceMs_ = nowMs;
        waitMs_ = backoff_.next();
        return Action::Disconnect;
      case State::Waiting:
        if (nowMs - sinceMs_ < waitMs_) return Action::None;
        state_ = State::Connecting;
        sinceMs_ = nowMs;
        return Action::Begin;
    }
    return Action::None;
  }

  State state() const { return state_; }

 private:
  uint32_t timeoutMs_;
  Backoff backoff_;
  State state_ = State::Idle;
  uint32_t sinceMs_ = 0;
  uint32_t waitMs_ = 0;
};

// Token rotation ("Olvidar placa"): the board keeps the previous token until the relay accepted
// the new one (_config/architecture.md → Pairing). If a rotation is still pending
// (the relay has not accepted the last new token), the relay still stores the OLDER token, so
// that one stays as `previous`.
// The relay accepted `accepted` (a register 204). If no rotation happened since that register
// was sent, nothing is pending any more; if the board rotated meanwhile, the relay now stores
// `accepted`, so that is the token the next register must present as previousToken.
template <typename Str>
inline Str previousAfterAccept(const Str &current, const Str &accepted) {
  return current == accepted ? Str() : accepted;
}

template <typename Str>
inline Str previousAfterRotation(const Str &current, const Str &pendingPrevious) {
  return pendingPrevious.empty() ? current : pendingPrevious;
}

}  // namespace som
