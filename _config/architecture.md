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
- The 2021 Docker Hub image lacks ESP32-C3 (esp32 core 1.0.6). We build our own image from current `main` (node 20, installs latest esp32 core 3.3.x which includes the C3 and ESP-NOW). Image lives in `server/`.

## Upload paths (browser)
- AVR (UNO, NANO old bootloader, future SoM NANO-C): `avrgirl-arduino` browser build (MIT), stk500v1 over Web Serial. Needs `window.Buffer` (buffer@6) and `window.process` (process@0.11) injected before load. Board profile `uno` / `nano`.
- ESP32-C3 / ESP32 / ESP8266: `esptool-js` (Apache-2.0) over Web Serial. C3 SuperMini enumerates as native USB-CDC (Espressif VID 0x303a); bootloader image at 0x0 on C3 (server returns the address per image).

## Block families (planned)
Core: logic, control, math, text, variables, lists, functions. Hardware: io, time, serial. ESP32-C3: wifi, ble (BLE only — the C3 has no Bluetooth Classic), espnow. Later: sensors, actuators, displays, neopixel.

## ESP-NOW model (decision 2026-10-16)
Name-based, broadcast-carried. Every board has a name block; `send <value> to <name>` and `send <value> to everyone` both transmit to the broadcast MAC with `{from, to, value}` in the payload; `when message arrives from <name>` filters on `to ∈ {me, everyone}` and `from`. No MAC addresses in the student UI. Unencrypted (classroom scope).

## Persistence
Projects in IndexedDB (name, workspace JSON, board, updatedAt). Export `.zip` with `.ino` + workspace JSON; import both. No server state.
