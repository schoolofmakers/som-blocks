# v1 PR plan — som-blocks (ESP32-C3 first)

Each line is one minimal PR off `staging`, shipped through `/greploop` to 5/5. Order matters within a track; tracks A and B run in parallel.

## Track A — compile server (`server/`)
A1. `server/compile`: Dockerfile + fly.toml building duinoapp-server from pinned upstream commit; esp32 core 3.3.x, esp8266, avr. Evidence: `/v3/info/boards` lists `esp32:esp32:esp32c3`. (ops-heavy; image is several GB)
A2. Smoke test script: compile blink for `esp32c3`, `uno`, `nano:cpu=atmega328old`; assert firmware present. Runs in CI against the deployed server.

## Track B — editor skeleton
B1. Vite + React + TS + Tailwind + Vitest + Playwright scaffold, PWA manifest, CI (typecheck/test/build). Empty shell deploys as static site.
B2. Blockly workspace component + toolbox from block-family modules + `ArduinoGenerator` core (sections: includes/definitions/setup/loop) + golden-test harness (workspace JSON → .ino).
B3. Core families: logic, control, math, text, variables, lists, functions (ES + EN messages, golden tests).
B4. Hardware families: io, time, serial (pin profiles from the board registry).
B5. Board registry (`_config/boards.md` → `src/boards`) + board picker UI; fqbn option handling (NANO old bootloader, C3 CDCOnBoot).
B6. Compile client for `/v3/compile` with the "no firmware = failure" rule, log panel showing arduino-cli output verbatim, 30 s timeout UX.
B7. `Transport` interface + `WebSerialTransport` + connect screen with browser support matrix.
B8. Flashers: esptool-js (C3/ESP32/ESP8266 multi-image) and avrgirl (UNO/NANO) behind one `Flasher` interface; Buffer/process polyfills. Evidence: video/serial log on real C3 and NANO.
B9. Serial monitor (xterm.js) + plotter (uPlot) over the active transport; baud picker.
B10. Projects: Dexie store, new/save/rename/duplicate, export `.zip` (.ino + workspace JSON), import; autosave.
B11. i18n plumbing: `?lang=`, saved preference, fallback to `es`, CI check for untranslated keys; language switch UI.
B12. Code view (read-only C++ with copy/download) — the teacher v1 feature.

## Track C — ESP32-C3 connectivity blocks (after B4 + A1)
C1. `wifi` family: connect to network, IP, HTTP GET/POST simple blocks (golden tests + on-device check).
C2. `espnow` family per the name-based broadcast model in `_config/architecture.md`: my name is / send to / send to everyone / when message arrives from. Two-board classroom demo as evidence.
C3. `ble` family (BLE only): advertise name, notify value, on write; phone-visible via nRF Connect as evidence.

## Track D — WiFi path (decisions 2026-10-17, spec in `_config/architecture.md` → Track D)
D1. `server/relay`: Hono HTTP relay (long-poll + SSE, bearer tokens hashed, in-memory TTL stores, limits) + fly.toml + tests with a fake device; protocol v1 as specified.
D2. `firmware/resident`: Arduino sketch for the C3 factory partition — Improv Wi-Fi over BLE + serial, pairing token in NVS, relay register/long-poll, OTA via `Update`, serial bridge, LED patterns, long-BOOT reset. Compiles on our compile server; flashed over USB from the editor.
D3. `firmware/SomLink`: Arduino library linked by the generator into OTA-flagged projects (same relay client, runs beside the student's sketch); size measured and recorded.
D4. Editor: Improv provisioning UI (BLE/serial via the Improv SDKs), pairing storage, `RelayTransport`, `RelayOtaFlasher`, "sube por WiFi" project flag; works from Android Chrome and (upload/monitor) iOS Safari. Evidence: phone video.
D5. Mobile layout pass for Blockly (touch targets, toolbox drawer, zoom controls).

## Explicitly out of v1
Accounts (teacher/student), starter projects by URL, progress events, extra languages beyond es/en, sensors/actuators/display families, SoM NANO-C board entry.
