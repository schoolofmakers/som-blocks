# server/compile — som-blocks compile server

The editor compiles sketches on a [duinoapp-server](https://github.com/duinoapp/duinoapp-server) (arduino-cli behind an HTTP API). The public 2021 Docker Hub image ships esp32 core 1.0.6, which has no ESP32-C3, so we build our own image from a pinned upstream commit with the current esp32 core (3.3.x).

duinoapp-server is GPL-3.0. We **run** it; we never copy its code into this repo. The Dockerfile clones it at build time.

| File | What it is |
|---|---|
| `Dockerfile` | Our image: node 20 + duinoapp-server at a pinned SHA + arduino-cli with `arduino:avr`, `esp8266:esp8266`, `esp32:esp32` |
| `fly.toml` | Fly.io app `som-compile` (region `gru`, 2 GB, always on) |
| `smoke.sh` | End-to-end check: server info, C3 in the board list, blink compiles for C3 / UNO / NANO (old bootloader) |

API contract (request/response shapes, the "no firmware = failure" rule): `_config/architecture.md`.

## Build

```bash
docker build --platform linux/amd64 -t som-compile:dev server/compile
```

- Always `linux/amd64`: arduino-cli and the toolchains are x86_64 Linux builds. On Apple Silicon this runs under emulation and is slow.
- The build downloads arduino-cli, refreshes the Arduino, esp8266 and Espressif indexes, installs the three cores and pre-processes the board list. It **fails** if the installed esp32 core is not 3.x or if `esp32:esp32:esp32c3` is missing from the processed boards.
- To move to a newer upstream commit: `--build-arg DUINOAPP_SHA=<full sha>` (upstream's default branch is `master`), then update the default in the Dockerfile once it passes the smoke test.
- Cores are installed at their latest version at build time, so two builds on different days can differ. `/v3/info/cores` shows what an image has.

## Run locally

```bash
docker run -d --name som-compile-dev -p 3031:3030 som-compile:dev
curl -s http://127.0.0.1:3031/v3/info/server
```

Port 3031 on the host avoids clashing with an old `duinoapp-server` container on 3030.

## Smoke test

```bash
bash server/compile/smoke.sh http://127.0.0.1:3031    # local
bash server/compile/smoke.sh https://som-compile.fly.dev  # deployed
```

Needs `curl` and `jq`. Prints one `PASS`/`FAIL` line per check and exits non-zero if any check fails. `SMOKE_TIMEOUT` (seconds, default 120) caps each compile request.

## Deploy (Fly.io)

From `server/compile/`:

```bash
fly launch --copy-config --no-deploy   # first time only: creates the app from fly.toml
fly deploy
bash smoke.sh https://som-compile.fly.dev
```

The Fly builder builds the image remotely (amd64), so no local build is needed to deploy. Set `COMPILE_SERVER_URL` as a GitHub Actions secret to have CI run the smoke test against the deployed server.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3030` | HTTP port inside the container |
| `SERVER_INFO_NAME` | `SoM Compile` | `/v3/info/server` → `name` |
| `SERVER_INFO_OWNER` | `School of Makers` | → `owner` |
| `SERVER_INFO_COUNTRY` | `CL` | → `country` |
| `SERVER_INFO_LOCATION` | `Santiago` | → `location` |

Upstream also reads `SERVER_INFO_WEBSITE` and `SERVER_INFO_DESCRIPTION` (unset by default).

## Known limits

- **Compile budget.** The public duinoapp instance times out around 30 s; the editor is designed around that budget. A first esp32 compile on a fresh machine is the slow case (no core cache yet), which is why the Fly machine never auto-stops.
- **Image size.** The image is several GB (the esp32 core pulls toolchains for every Espressif chip). Builds and pulls take minutes.
- **Memory.** esp32 links need ~1.5 GB peak; the Fly VM has 2 GB. Concurrent esp32 compiles beyond the `hard_limit` in `fly.toml` are queued by Fly.
- **amd64 only.** No arm64 image.
