#!/usr/bin/env bash
# Builds the resident firmware on our compile server (duinoapp-server v3 API) and saves the images.
#
# Usage: firmware/resident/build.sh [compile-server-url]   (default http://127.0.0.1:3031)
# Env:   SOM_EDITOR_URL, SOM_RELAY_URL  override the URLs compiled in (src/config.h)
#        SOM_IMPROV_BLE=0               serial-only Improv build (no BLE)
#        OUT_DIR                        where images go (default firmware/resident/build)
#        COMPILE_TIMEOUT                seconds (default 900; a cold esp32 compile is slow)
# Needs: bash, curl, jq, base64.
#
# The request is the shape src/compile uses: one files[] entry per source, named
# "resident/<path>", so the server recreates the sketch folder (resident.ino + src/**).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
server="${1:-http://127.0.0.1:3031}"
server="${server%/}"
out_dir="${OUT_DIR:-$here/build}"
fqbn="esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs"

for dep in curl jq base64; do
  command -v "$dep" >/dev/null 2>&1 || { echo "missing dependency: $dep" >&2; exit 2; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Collect resident.ino and src/** (never test/ or build/), applying the env overrides to config.h.
files='[]'
while IFS= read -r rel; do
  content="$(cat "$here/$rel"; printf x)"
  content="${content%x}"
  if [ "$rel" = "src/config.h" ]; then
    if [ -n "${SOM_EDITOR_URL:-}" ]; then
      content="$(printf '%s' "$content" | sed "s|^#define SOM_EDITOR_URL \".*\"|#define SOM_EDITOR_URL \"$SOM_EDITOR_URL\"|"; printf x)"
      content="${content%x}"
    fi
    if [ -n "${SOM_RELAY_URL:-}" ]; then
      content="$(printf '%s' "$content" | sed "s|^#define SOM_RELAY_URL \".*\"|#define SOM_RELAY_URL \"$SOM_RELAY_URL\"|"; printf x)"
      content="${content%x}"
    fi
    if [ -n "${SOM_IMPROV_BLE:-}" ]; then
      content="$(printf '%s' "$content" | sed "s|^#define SOM_IMPROV_BLE .*|#define SOM_IMPROV_BLE $SOM_IMPROV_BLE|"; printf x)"
      content="${content%x}"
    fi
  fi
  printf '%s' "$content" > "$tmp/file"
  files="$(jq --arg name "resident/$rel" --rawfile content "$tmp/file" '. + [{name: $name, content: $content}]' <<<"$files")"
done < <(cd "$here" && { echo resident.ino; find src -type f \( -name '*.h' -o -name '*.cpp' \) | sort; })

jq -n --arg fqbn "$fqbn" --argjson files "$files" \
  '{fqbn: $fqbn, files: $files, flags: {verbose: false, preferLocal: false}, libs: []}' > "$tmp/request.json"

echo "Compiling $(jq '.files | length' "$tmp/request.json") files for $fqbn on $server ..."
curl -fsS --max-time "${COMPILE_TIMEOUT:-900}" -H 'Content-Type: application/json' \
  -d @"$tmp/request.json" "$server/v3/compile" -o "$tmp/response.json"

mkdir -p "$out_dir"
jq -r '.log // ""' "$tmp/response.json" > "$out_dir/compile.log"

# "No firmware = failure" (_config/architecture.md): show the log and stop.
if ! jq -e '(.files | type == "array") and (.files | length == 4)' "$tmp/response.json" >/dev/null 2>&1; then
  echo "Compile FAILED — log:" >&2
  cat "$out_dir/compile.log" >&2
  exit 1
fi

save() {  # save <address> <file name>
  jq -r --argjson a "$1" '.files[] | select(.address == $a) | .data' "$tmp/response.json" | base64 --decode > "$out_dir/$2"
}
save $((0x10000)) resident.app.bin   # the image the relay OTA path takes, and USB at 0x10000
save $((0x8000)) partitions.bin
save $((0xe000)) boot_app0.bin
# The server labels the bootloader 0x1000; on the C3 it goes to 0x0 (_config/boards.md).
jq -r '.files[] | select(.address != 65536 and .address != 32768 and .address != 57344) | .data' \
  "$tmp/response.json" | base64 --decode > "$out_dir/bootloader.bin"

cat > "$out_dir/flash.json" <<EOF
{
  "chip": "esp32c3",
  "flashMode": "keep", "flashFreq": "keep", "flashSize": "keep",
  "images": [
    { "address": "0x0", "file": "bootloader.bin" },
    { "address": "0x8000", "file": "partitions.bin" },
    { "address": "0xe000", "file": "boot_app0.bin" },
    { "address": "0x10000", "file": "resident.app.bin" }
  ]
}
EOF

grep -E 'Sketch uses|Global variables' "$out_dir/compile.log" || true
ls -l "$out_dir"
echo "OK: images in $out_dir (flash with keep/keep/keep, bootloader at 0x0)"
