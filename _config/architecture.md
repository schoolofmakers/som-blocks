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
- `RelayTransport` — WiFi, through our relay service (below). Works from ANY browser including iOS Safari, because the page only talks HTTPS to our server; the board talks to the same server. This is the mobile path.
Browser support is shown on the connect screen; unsupported combinations get an explicit message, never a silent failure.

## Over-the-air upload to the ESP32-C3 over WiFi (decision 2026-10-16, replaces an earlier BLE idea)
Why a relay and not direct LAN: the editor is served over HTTPS, and browsers block an HTTPS page from calling `http://192.168.x.x` (mixed content + Private Network Access). So the phone cannot POST firmware to the board directly. The board pulls instead.
- **Relay service** (`server/relay`, our code, MIT, tiny Node/Hono): the board keeps a WebSocket to it; the editor calls it over HTTPS. Endpoints: device registers with a claim code; editor claims a device by code; editor posts a build id → relay tells the board → board downloads the image over HTTPS from the relay and flashes it with `Update`; board streams serial lines up and accepts lines down (monitor over WiFi).
- **SoM resident firmware** on the C3 `factory` partition: WiFi provisioning (credentials entered once over USB from the editor, or via a captive portal on first boot), relay connection, OTA receive into `ota_0`, claim code shown in the serial monitor and derivable from the MAC. Long BOOT-press reboots to `factory` as recovery.
- **`SomLink` library** linked by the generator into every C3 sketch: keeps the relay connection + OTA + serial bridge alive inside the student's program, so the next upload from the phone works without touching USB.
- Flow from a phone: compile on the compile server → editor posts the image to the relay as a build → relay notifies the claimed board → board downloads (~200–400 KB in a few seconds on WiFi) → verifies → reboots into the new sketch. Progress and the board's serial output appear in the editor.
- Requires the board to be on a WiFi network with internet (school WiFi or a phone hotspot). Offline-lab variant: when the editor itself is served over plain HTTP on a lab laptop (local Docker setup), a direct `http://<board-ip>/update` push is allowed by the browser and can be offered as a shortcut; same board firmware.
- Bluetooth is not used for upload. BLE remains available as a *block family* for student projects (C3 is BLE-only, no Classic).

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
