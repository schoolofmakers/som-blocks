# som-blocks — Navigation Guide

You are here. Read this first.

<!-- self-description -->
Browser blocks editor for School of Makers classes (Chile, ages 10–14). Students build Arduino programs with Blockly in Spanish or English, compile on a hosted duinoapp-server (arduino-cli) and flash UNO/NANO/ESP32-C3 boards over Web Serial. ESP32-C3 SuperMini first: WiFi, BLE and ESP-NOW blocks so boards talk to each other.
<!-- /self-description -->

## Structure
1. `CLAUDE.md` — this navigation guide
2. `_config/` — durable rules: build discipline, agentic practices, standards, architecture, boards, i18n. Read before working.
3. `src/` — Vite + React + TypeScript PWA (created by the first PRs): `blocks/` (block families + generators), `boards/` (board registry), `compile/` (server client), `transport/` (Web Serial USB / WiFi relay), `flash/` (esptool-js, avrgirl, relay OTA), `ui/`, `i18n/`
4. `firmware/` — SoM resident firmware for the ESP32-C3 (WiFi provisioning, relay link, OTA, serial bridge) and the `SomLink` Arduino library the generator links into student sketches
5. `server/` — `compile/` (Dockerfile + fly.toml for the rebuilt duinoapp-server image) and `relay/` (device relay for WiFi OTA + serial over WiFi), both on Fly.io
6. `docs/` — ADRs (`docs/adr/`), brainstorms, reference notes
7. `README.md` — dev commands and how to run the compile server locally

## How to work here
- Conventions & build discipline: `_config/greploop-method.md` (minimal PRs, review to 5/5 before merge).
- How agents do the work inside each PR: `_config/agentic-practices.md` (proof before "done", senior-engineer briefs, orchestrator/implementer split, variants for taste, screens must earn their existence, corpus before code).
- Project-specific rules: `_config/standards.md` · `_config/architecture.md` · `_config/boards.md` · `_config/i18n.md`.
- Prior art: the validated prototype and the reverse-engineering of hello-blocks.com live in `~/Documents/som-blocks-poc` (branch `prototype/som-blocks-poc`). Copy nothing from Hello Blocks' recovered source; the DuinoApp server API contract is documented in `_config/architecture.md`.

## Build discipline (every code change)
Plan → slice into minimal PRs → branch off `staging` → implement one unit + tests (per `_config/agentic-practices.md`) → `/greploop` to 5/5 → squash-merge. Below 5/5, split the PR. See `_config/greploop-method.md`. No PR is "done" without evidence: test output in the description, screenshots for UI, and for flashing changes a photo/video or serial log from a real board.
