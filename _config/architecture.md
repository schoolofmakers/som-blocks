# Architecture — som-blocks

## Shape
Static single-page editor (Vite/TS/Blockly) → HTTPS JSON → compile server (duinoapp-server Docker on Fly.io) → firmware bytes back to the browser → Web Serial flash to the board. No database, no accounts in v1.

## Compile server API (duinoapp-server, GPL-3.0, github.com/duinoapp/duinoapp-server — we run it, we don't vendor it)
- `GET /v3/info/server` → `{name, location, country, owner, website, description}` (set via `SERVER_INFO_*` env).
- `GET /v3/info/cores`, `GET /v3/info/boards`, `GET /v3/info/libraries?search=&limit=&skip=&exact=`.
- `POST /v3/compile` body `{fqbn, files:[{name:"<sketch>/<sketch>.ino", content}], flags:{verbose,preferLocal}, libs:[{name,url,version}]}`.
  - AVR → `{hex (base64 Intel HEX), log}`; esp8266 → `{files:[{data,address:0}], log}`; esp32 → `{files:[4 images with addresses], flash_freq, flash_mode, log}`.
  - On gcc failure the reply is `{log}` with no `hex`/`files` and often no `error` → clients MUST treat "no firmware" as failure and show `log`.
  - `libs` entries must be objects with a `url` (zip); a bare string crashes the request (HTTP 200, empty body).
- CORS is `*`. Timeout observed ≈30 s on the public instance.
- The 2021 Docker Hub image lacks ESP32-C3 (esp32 core 1.0.6). We build our own image (`server/compile`, A1) from upstream `master` pinned at 98bbc30 (node 20): cores arduino:avr 1.8.8, esp32 3.3.12 (has the C3 and ESP-NOW), esp8266 3.1.2; 4.4 GB; Fly region `gru`. Cores install at build time, so a rebuild may bump versions — the Dockerfile fails the build if the C3 or UNO are missing.

## Transports (how the browser reaches a board)
One `Transport` interface (`open/close/write/onData`) with two implementations; flashers and the serial monitor only see the interface.
- `WebSerialTransport` — USB on desktop Chrome/Edge (Web Serial). Not available on any mobile browser. Fast path and rescue path.
- `RelayTransport` — WiFi, through our relay service (Track D below). Works from ANY browser including iOS Safari for upload/monitor, because the page only talks HTTPS to our server; the board talks to the same server. Provisioning the board's WiFi needs Web Bluetooth (Android Chrome) or Web Serial (desktop).
Browser support is shown on the connect screen; unsupported combinations get an explicit message, never a silent failure.

## Track D — WiFi provisioning, pairing and over-the-air upload (decisions 2026-10-17)

### Provisioning (how a board learns the WiFi) — ticket #39
- **Improv Wi-Fi** (improv-wifi.com, Apache-2.0 spec + SDKs), both transports from the same firmware:
  - **Phone:** Improv over **BLE** via Web Bluetooth (Android Chrome; not iOS Safari — iOS phones use a board someone else provisioned, or a desktop).
  - **Desktop:** Improv over **serial** via Web Serial (USB), the same cable used to flash.
- The editor's connect screen gets a "Conectar a WiFi" step that runs the Improv flow (scan is optional; SSID + password typed or chosen), shows the state the firmware reports (authorizing → provisioning → provisioned), and reads the **provisioned URL** the firmware returns.
- No captive portal in v1.

### Pairing (who may push firmware to which board) — ticket #38
- The firmware generates a **pairing token** (32 random bytes, hex) at first boot, keeps it in NVS, and exposes it only through a physical channel: the Improv *provisioned URL* (`https://<editor>/pair?device=<deviceId>&token=<token>`) returned at the end of provisioning over BLE or USB. Physical access (BLE range or cable) is the trust boundary; re-provisioning rotates nothing by default, "Olvidar placa" on the board (long BOOT press) regenerates the token. **Rotation at the relay:** `register` with a token whose hash differs from the stored one is accepted only when the stored record is absent or has been offline (no poll) for ≥ 60 s; it replaces the hash and every editor must re-pair through the physical channel. A `register` with a different token while the board is online is refused with `409`. Hijacking a board therefore needs its MAC and a window where the board is off, and still yields nothing without a reprovisioning session in BLE range or on the cable.
- `deviceId` = the chip's base MAC, lower-case hex without separators. The editor stores `{deviceId, token, name}` per project in IndexedDB. Every relay call carries the raw token as a bearer header over HTTPS; the relay **stores only `sha256(token)`** and compares hashes.
- Any editor that presents the token can push to that board; there are no accounts in v1.

### SomLink linking policy — ticket #40
- SomLink (the in-sketch WiFi/OTA/serial-bridge client) is linked **only into projects flagged "sube por WiFi"**; USB-only projects stay as they are. Flash budget: WiFi HTTPS sketches already reach 84% of the default 1.25 MB OTA slot, so an OTA-flagged project that does not fit shows a clear "demasiado grande para subir por WiFi" error from the compile step (the server log has the size), never a silent failure. Measure SomLink's cost in D3 and record it in `_config/boards.md`.
- Partition scheme stays `default` (two OTA slots, no factory partition) for OTA projects; a bigger single-slot layout and a factory recovery image are out of v1.

### Relay service (`server/relay`, Fly.io `gru`, our code, MIT) — ticket #41
Why a relay: an HTTPS page cannot call `http://192.168.x.x` (mixed content + Private Network Access), so the board pulls from the relay instead of the editor pushing to the board.
**Transport choice:** plain HTTPS with long-polling on the board side and Server-Sent Events on the editor side. No WebSocket on the board (the common Arduino WebSocket libraries are LGPL and the ESP-IDF client is not in the Arduino core); firmware download uses the core's `HTTPUpdate`/`Update` over `NetworkClientSecure` (`setInsecure()` to the relay, same classroom trade-off as C1).

Protocol **v1** (all JSON unless noted; `Authorization: Bearer <token>` on every device and editor call; the relay stores `sha256(token)` per device):
- Device → relay
  - `POST /v1/devices/{deviceId}/register` `{ fw: string, name: string, chip: "esp32c3" }` → `204`. Sent on every boot and after every WiFi reconnect; first call creates the device record.
  - `GET /v1/devices/{deviceId}/next?wait=25` → `204` after `wait` seconds with nothing, or `200 { buildId, size, sha256 }` when a build is queued (long poll; the device loops on it).
  - `GET /v1/builds/{buildId}/image` → `application/octet-stream` (the app image for `ota_0/ota_1`), `Content-Length` set; the device streams it into `Update`.
  - `POST /v1/devices/{deviceId}/status` `{ buildId, state: "downloading"|"flashing"|"rebooting"|"running"|"failed", detail? }` → `204`.
  - `POST /v1/devices/{deviceId}/serial` `{ lines: string[] }` (board output, batched ≤ 50 lines / 500 ms) → `204`.
  - `GET /v1/devices/{deviceId}/input?wait=25` → `204` or `200 { lines: string[] }` (text the student typed in the monitor).
- Editor → relay
  - `GET /v1/devices/{deviceId}` → `{ online: boolean, lastSeen, fw, name }`; `GET /v1/builds/{buildId}` → `{ state }` or `404` once expired/lost.
  - `POST /v1/devices/{deviceId}/builds` (body: the raw app image, `Content-Type: application/octet-stream`, header `X-Image-Sha256`) → `201 { buildId }`. Max 2 MB; one pending build per device (a new one replaces it).
  - `GET /v1/devices/{deviceId}/events` → **SSE** stream: `online`, `offline`, `status {buildId,state,detail}`, `serial {lines}`.
  - `POST /v1/devices/{deviceId}/input` `{ line }` → `204`.
- Storage: in-memory with TTLs (builds 10 min, device records 24 h, serial ring 500 lines). A relay restart drops device records (boards re-register within one poll cycle) and any queued build. The editor detects that: it keeps the `buildId`, expects a `status` event within 60 s of the device being `online`, and its SSE connection drops on restart — on either it shows "la subida se perdió; vuelve a intentar" and re-POSTs the same image when the device is online again (`GET /v1/devices/{id}` and `GET /v1/builds/{buildId}` → `404` confirm the loss). Limits per device: control calls (`register`, `next`, `status`, `input`) 60/min; `serial` batches 150/min (a batch every 500 ms is 120/min) with ≤ 50 lines / 8 kB each; builds 10/h; image ≤ 2 MB. Over the limit the relay answers `429` with `Retry-After` and the firmware backs off. Health: `GET /healthz`.
- Hosting: Fly app `som-relay`, region `gru`, `auto_stop_machines = off` (long polls), one shared-cpu machine; `fly.toml` in `server/relay`.

### Resident firmware (`firmware/resident`, Arduino sketch for the C3, built by our own compile server) — ticket #42
- The `default` scheme has no factory partition (nvs, otadata, ota_0, ota_1, spiffs, coredump), so the resident firmware is an ordinary app in an OTA slot: the editor flashes it over USB into `ota_0`; an OTA-flagged student sketch (which carries SomLink and therefore stays updatable) goes into the other slot; the next OTA alternates back. A sketch without SomLink makes the board USB-only until the student flashes again over the cable — that is the documented recovery, no factory image in v1. Implements Improv BLE + Improv serial, WiFi connect with stored credentials, pairing token, relay register + long-poll loop, OTA into the next slot via `Update`, serial bridge (relay ↔ USB-CDC), status LED patterns (GPIO 8 active-low: breathing = waiting for WiFi, double blink = online, fast = flashing). Long BOOT press (≥ 5 s) = forget WiFi + regenerate token; BOOT at reset = ROM download mode (unchanged).
- First flash of the resident firmware happens over USB from the editor (a "Preparar placa para WiFi" action) or pre-flashed on boards SoM hands out.

### SomLink library (`firmware/SomLink`, Arduino library) — ticket #43
- Linked by the generator into OTA-flagged sketches: `#include <SomLink.h>`, `SomLink.begin()` in setup (uses the stored WiFi + token from NVS, registers, starts the long-poll on a FreeRTOS task), `SomLink.loop()` not required. Keeps the board updatable and its `Serial` output mirrored to the relay while the student's program runs. Measured size goes into `_config/boards.md`.

### Editor side (`src/transport/relay*.ts`, `src/flash/relay-ota.ts`, provisioning UI) — ticket #44
- `RelayTransport` implements the `Transport` interface over SSE (down) + `POST /input` (up) so the serial monitor works unchanged. `RelayOtaFlasher` implements `Flasher`: POST the compiled app image, then follow `status` events to drive the progress bar. Provisioning UI uses the Improv JS SDKs (BLE on Android Chrome, serial on desktop) and stores the pairing from the provisioned URL.

## Upload paths (browser, USB)
- AVR (UNO, NANO old bootloader, future SoM NANO-C): `avrgirl-arduino` browser build (MIT), stk500v1 over Web Serial. Needs `window.Buffer` (buffer@6) and `window.process` (process@0.11) injected before load. Board profile `uno` / `nano`.
- ESP32-C3 / ESP32 / ESP8266: `esptool-js` (Apache-2.0) over Web Serial. C3 SuperMini enumerates as native USB-CDC (Espressif VID 0x303a). The flasher takes the **bootloader address from our board registry** (C3 = 0x0), not from the server, because upstream returns 0x1000 for chips whose address is 0 (see `_config/boards.md`). Other image addresses (boot_app0 0xe000, partitions 0x8000, app 0x10000) come from the server response. Flash mode/frequency/size are always `keep` (like arduino-esp32's own upload recipe): the server's `flash_mode`/`flash_freq` (qio/80m) are logged only, because rewriting the C3 bootloader header to QIO stops it booting (verified on hardware, see `_config/boards.md` → "Flash params rule").
- AVR loads avrgirl's `dist/avrgirl-arduino.global.min.js` as a classic `<script>` (never `import()`: its bundled stk500 breaks in strict mode) and lends it the picked port behind a draining wrapper (avrdude-style drain after sync).

## Block families (planned)
Core: logic, control, math, text, variables, lists, functions. Hardware: io, time, serial. ESP32-C3: wifi, ble (BLE only — the C3 has no Bluetooth Classic), espnow. Later: sensors, actuators, displays, neopixel.

## ESP-NOW model (decision 2026-10-16)
Name-based, broadcast-carried. Every board has a name block; `send <value> to <name>` and `send <value> to everyone` both transmit to the broadcast MAC with `{from, to, value}` in the payload; `when message arrives from <name>` filters on `to ∈ {me, everyone}` and `from`. No MAC addresses in the student UI. Unencrypted (classroom scope).

## Persistence
Projects in IndexedDB (name, workspace JSON, board, updatedAt). Export `.zip` with `.ino` + workspace JSON; import both. No server state.
