#!/usr/bin/env bash
# Smoke test for the som-blocks compile server (duinoapp-server v3 API).
# Usage: smoke.sh [base-url]   (default http://127.0.0.1:3031)
# Prints one PASS/FAIL line per check; exits non-zero if any check fails.
# Needs: bash, curl, jq.
set -uo pipefail

BASE_URL="${1:-http://127.0.0.1:3031}"
BASE_URL="${BASE_URL%/}"
TIMEOUT="${SMOKE_TIMEOUT:-120}"

failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; failures=$((failures + 1)); }

for dep in curl jq; do
  command -v "$dep" >/dev/null 2>&1 || { echo "FAIL missing dependency: $dep"; exit 2; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Server info is JSON with a name.
if curl -fsS --max-time 15 "$BASE_URL/v3/info/server" -o "$tmp/server.json" \
  && jq -e 'type == "object" and has("name")' "$tmp/server.json" >/dev/null 2>&1; then
  pass "info/server ($(jq -r '.name' "$tmp/server.json"))"
else
  fail "info/server" "no JSON object with .name from $BASE_URL/v3/info/server"
fi

# 2. Board list contains the ESP32-C3.
if curl -fsS --max-time 60 "$BASE_URL/v3/info/boards" -o "$tmp/boards.json" \
  && jq -e '[.[] | select(.fqbn == "esp32:esp32:esp32c3")] | length > 0' "$tmp/boards.json" >/dev/null 2>&1; then
  pass "info/boards lists esp32:esp32:esp32c3"
else
  fail "info/boards lists esp32:esp32:esp32c3"
fi

# 3. Blink compiles to firmware for each v1 board.
# Firmware presence is the only success signal: on a gcc error the server
# replies {log} with no hex/files and often no error field.
# Plain pin numbers rather than LED_BUILTIN: the C3 SuperMini LED is GPIO 8,
# while the generic esp32c3 variant maps LED_BUILTIN to an RGB pseudo-pin.
blink_sketch() {
  cat <<EOF
const int LED_PIN = $1;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
EOF
}

compile_check() {
  local fqbn="$1" sketch="$2" firmware_filter="$3"
  local body out="$tmp/compile-${fqbn//[^a-zA-Z0-9]/_}.json"
  body="$(jq -n --arg fqbn "$fqbn" --arg content "$sketch" '{
    fqbn: $fqbn,
    files: [{name: "blink/blink.ino", content: $content}],
    flags: {verbose: false, preferLocal: false},
    libs: []
  }')"
  if ! curl -fsS --max-time "$TIMEOUT" -H 'Content-Type: application/json' \
      -d "$body" "$BASE_URL/v3/compile" -o "$out"; then
    fail "compile $fqbn" "request failed"
    return
  fi
  if jq -e "$firmware_filter" "$out" >/dev/null 2>&1; then
    pass "compile $fqbn"
  else
    fail "compile $fqbn" "no firmware in reply; log: $(jq -r '.log // .error // "(empty)"' "$out" 2>/dev/null | tail -n 5 | tr '\n' ' ')"
  fi
}

avr_fw='(.hex | type == "string") and (.hex | length > 0)'
esp_fw='(.files | type == "array") and (.files | length > 0) and all(.files[]; (.data | type == "string") and (.data | length > 0))'

compile_check "esp32:esp32:esp32c3" "$(blink_sketch 8)" "$esp_fw"
compile_check "arduino:avr:uno" "$(blink_sketch 13)" "$avr_fw"
compile_check "arduino:avr:nano:cpu=atmega328old" "$(blink_sketch 13)" "$avr_fw"

if [ "$failures" -gt 0 ]; then
  echo "SMOKE FAILED: $failures check(s) failed against $BASE_URL"
  exit 1
fi
echo "SMOKE OK: all checks passed against $BASE_URL"
