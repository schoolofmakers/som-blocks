# firmware/resident — SoM resident firmware (ESP32-C3)

The program a SuperMini runs so it can be reached over WiFi: it learns the WiFi through **Improv Wi-Fi** (USB serial or Bluetooth LE), keeps a **pairing token**, talks to our **relay** (register, long-poll, OTA, serial bridge) and shows its state on the blue LED. Contract: `_config/architecture.md` → Track D.

| | |
|---|---|
| fqbn | `esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs` |
| core | esp32 3.3.12 (our compile server image) |
| libraries | only the core's: WiFi, NetworkClientSecure, HTTPClient, Update, Preferences, BLE (NimBLE) + mbedtls. No third-party code. |
| size | 1,429,649 B app = 72% of the 1,966,080 B `min_spiffs` slot; globals 43,408 B. Serial-only build (`SOM_IMPROV_BLE=0`): 1,157,811 B. |

**Why `min_spiffs` and not `default`:** BLE + WiFi + HTTPS together do not fit the `default` 1,310,720 B OTA slot on core 3.3.12 (109%). `min_spiffs` keeps two OTA slots (1,966,080 B each). Every project flagged "sube por WiFi" must be compiled with the same `PartitionScheme=min_spiffs` option; USB-only projects keep `default`. Measurements and the rule: `_config/boards.md`, `_config/architecture.md` → SomLink linking policy.

## Layout

| Path | What |
|---|---|
| `resident.ino` | `setup()` / `loop()`: banner, tasks, BOOT button, LED. The loop never blocks. |
| `src/config.h` | Editor + relay URLs, `SOM_IMPROV_BLE`, pins, timings, limits |
| `src/Provisioning.*` | Improv command handling (serial + BLE), WiFi station link with backoff, scan, identify, "Olvidar placa" |
| `src/ImprovBle.*` | Improv GATT service + advertisement (core BLE library) |
| `src/Pairing.*` | Device id, token, previous token, WiFi credentials, pending OTA — in NVS |
| `src/RelayClient.*` | Task `som-relay`: register → `next?wait=25` → OTA → `status` |
| `src/SerialBridge.*` | Task `som-bridge`: `serial` batches up, `input` long-poll down |
| `src/RelayHttp.*` | One HTTPS call with bearer token, rate limit, heap guard, `Retry-After` |
| `src/Console.*`, `src/Led.*` | Shared USB-CDC writer; LED driver |
| `src/core/*.h` | Arduino-free logic (Improv framing, state machines, JSON, queue) — host-tested |
| `test/` | `run.sh` builds `test_core.cpp` with the host `c++` (ASan + UBSan); CI job `firmware` |
| `build.sh` | Compiles on our compile server and saves the images |

## Build

```bash
docker run -d --name som-compile-dev -p 3031:3030 som-compile:dev   # or use the deployed server
firmware/resident/build.sh http://127.0.0.1:3031
SOM_RELAY_URL=http://192.168.1.20:8080 firmware/resident/build.sh  # point at a local relay
SOM_IMPROV_BLE=0 firmware/resident/build.sh                          # serial-only Improv
```

`build.sh` posts `resident.ino` and every `src/**` file as `files[]` entries named `resident/<path>` (the compile client contract in `_config/architecture.md`); the server recreates the sketch folder. The compile API takes no `-D` flags, so the URL / BLE overrides are applied by rewriting the `#define` lines of `src/config.h` in the uploaded copy. Output in `firmware/resident/build/` (git-ignored): `bootloader.bin`, `partitions.bin`, `boot_app0.bin`, `resident.app.bin`, `flash.json`, `compile.log`. "No firmware in the reply" is a failure and prints the log.

Host tests: `firmware/resident/test/run.sh`.

## Flash over USB

- **From the editor:** "Preparar placa para WiFi" (D4) flashes these four images.
- **By hand (esptool-js / esptool):** bootloader at `0x0` (not the `0x1000` the server labels it with, `_config/boards.md`), partitions `0x8000`, boot_app0 `0xe000`, app `0x10000`, with flash mode / frequency / size all `keep`. `flash.json` lists them. Example: `esptool.py --chip esp32c3 write_flash --flash_mode keep --flash_freq keep --flash_size keep 0x0 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 resident.app.bin`.

Going back to USB-only: flash any normal (`default`-partition) sketch over USB. That rewrites the partition table and replaces the resident.

## Using it

**Serial banner** (115200, USB-CDC) at boot: firmware + version, board name `SoM-xxxx`, device id (MAC), running partition, free heap (after and before BLE) and the largest free block. If WiFi is stored, the next line is `Emparejar: <provisioned URL>`.

**Provisioned URL** `https://<editor>/pair?device=<mac-hex>&token=<64 hex>` — returned as the Improv result after a successful "send Wi-Fi settings" (BLE or serial), returned again by a serial "request current state" while provisioned, and printed on USB as `Emparejar: …` at boot and after provisioning. It is the only place the token ever appears, and only on the physical channels: those lines are never mirrored to the relay.

**Improv**: desktop Chrome/Edge over USB (Web Serial) or Android Chrome over Bluetooth (Web Bluetooth); the official demo pages (improv-wifi.com, `improv-wifi/sdk-serial-js`, `sdk-ble-js`) work as clients. Supported: send Wi-Fi settings, request current state (serial) / identify (BLE: LED blinks slowly for 5 s), device info (`som-resident`, version, `ESP32-C3`, `SoM-xxxx`), scan networks. Credentials are stored only after the board actually joined the network.

**LED (GPIO 8, active-low)**

| Pattern | Meaning |
|---|---|
| slow breathing | no WiFi (not provisioned, or reconnecting) |
| double blink every 2 s | WiFi connected |
| fast blink (5 Hz) | downloading / flashing an OTA |
| on ½ s / off ½ s for 5 s | Improv identify |

**BOOT button**: hold ≥ 5 s while running = "Olvidar placa": WiFi forgotten, new pairing token (the old one is kept until the relay accepts the new one; pair the editor again over USB or BLE). BOOT held while plugging in / resetting = ROM download mode, unchanged.

## Relay behaviour

- `register {fw, name, chip, previousToken?}` on boot and after every WiFi (re)connection; `previousToken` only while a rotation is pending, cleared after a `204`. `409` = the relay holds a different token: logged ("Emparéjala de nuevo por USB"), retried every ≥ 60 s.
- `next?wait=25` loop. `404 unknown_device` / `401` on any call → register again (relay restart, TTL, DELETE, rotation).
- OTA: `status downloading` → `GET /v1/builds/{id}/image` into the other OTA slot with `Update`, refusing a `Content-Length` that differs from `size` or an image larger than the slot or 2 MB; sha256 (mbedtls) of the streamed bytes compared with the relay's digest **before** `Update.end()`; then `status flashing` → `Update.end()` (validates the image, switches the boot partition) → `status rebooting` → restart. Any error → `Update.abort()` + `status failed` with the reason (`replaced` when the image URL answers 404 because a newer upload replaced the build); the running app stays. After the reboot, the resident reports `running` for the stored build id, or `failed` if the bootloader fell back to the previous app.
- Serial bridge: log lines and text typed on USB go up as `serial` batches (≤ 50 lines / 8 kB, ≥ 500 ms apart); `input` lines are written to USB. While the board prints, `input` uses `wait=2` so output is not held behind a 25 s poll; idle, `wait=25`. The provisioned URL and Improv frames are never mirrored.
- Limits: control calls share a 50/min token bucket (relay: 60/min); errors back off 1 s → 60 s, honouring `Retry-After` (capped at 5 min). TLS is not opened when the largest free heap block is under 45 kB.
- HTTPS uses `NetworkClientSecure::setInsecure()` (classroom trade-off, same as C1): encrypted, server not authenticated.

## NVS contract (namespace `som`, shared with SomLink — D3)

| Key | Value |
|---|---|
| `ssid`, `pass` | WiFi credentials |
| `token` | pairing token, 64 hex chars |
| `prevToken` | previous token while a rotation is pending, else empty |
| `otaBuild`, `otaSlot` | build id + partition label of the last OTA, until its `running`/`failed` is reported |

A student sketch with SomLink boots from the slot the resident wrote; SomLink must report `running` for `otaBuild` and clear both keys.

## Corpus references

improv-wifi/sdk-cpp (Apache-2.0, framing and checksum), improv-wifi/sdk-serial-js and sdk-ble-js (what the clients expect), jnthas/Improv-WiFi-Library (MIT, BLE characteristic properties and scan responses), espressif/arduino-esp32 `libraries/Update/examples/HTTPS_OTA_Update`, `libraries/HTTPUpdate`, `libraries/Preferences`, `libraries/BLE`. Patterns only; nothing copied. Improv framing was written from the spec instead of vendoring sdk-cpp: sdk-cpp reads past the buffer on a short WIFI_SETTINGS packet, has no text passthrough for a shared serial port, and no BLE reassembly.
