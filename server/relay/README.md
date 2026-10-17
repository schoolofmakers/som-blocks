# server/relay — som-blocks device relay

An HTTPS page cannot call a board on the classroom LAN (`http://192.168.x.x` is mixed content and blocked by Private Network Access), so boards and editors both talk to this relay: the board **pulls** (long-poll) builds and typed input, the editor **pushes** builds and follows status and serial output over **Server-Sent Events**. Protocol v1, pairing and limits: `_config/architecture.md` → "Track D" → "Relay service". This README covers running it.

Our code, MIT. Node 22 + TypeScript + [Hono](https://hono.dev) (MIT) on `@hono/node-server`. Separate package: the editor's root `pnpm` commands do not build or lint it.

| File | What it is |
|---|---|
| `src/app.ts` | All routes (`createRelay()`), presence + TTL sweep |
| `src/store.ts` | `Store` interface + `MemoryStore` (device records, builds, serial ring, input queue) |
| `src/hub.ts` | In-process wake-ups for long-polls and fan-out to SSE streams |
| `src/auth.ts` · `src/rate-limit.ts` · `src/body.ts` | Bearer tokens (sha256, constant-time), per-device limits, bounded body reads |
| `src/index.ts` | Server entry: env, sweep timer, graceful shutdown |
| `scripts/fake-device.ts` | A firmware stand-in for end-to-end runs |
| `Dockerfile` · `fly.toml` | Fly app `som-relay` (region `gru`, always on, one machine) |

## Run and test

```bash
cd server/relay
pnpm install
pnpm dev                 # http://127.0.0.1:8080, reloads on change
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm build && pnpm start # compiled, as in the container
```

Tests use `app.request()` with an injected clock and fake timers for long-poll/SSE timing, plus a real listening server for client disconnects and a stalled download (`test/server.test.ts`).

## Fake device (end-to-end by hand)

With the relay running:

```bash
TOKEN=$(openssl rand -hex 32)
pnpm fake-device --relay http://127.0.0.1:8080 --device fa4e00c3c3c3 --token $TOKEN
```

It registers, long-polls `next`, downloads and sha-checks a pushed image, reports `downloading → flashing → rebooting → running` (re-registering on "boot"), sends a serial batch every 500 ms when it has lines, and echoes monitor input back as `eco: <line>`. `--builds 1` exits after one build; `--wait 5` shortens the long-polls; `--previous-token` exercises rotation. Then play the editor with curl:

```bash
B=http://127.0.0.1:8080/v1; H="Authorization: Bearer $TOKEN"; D=fa4e00c3c3c3
curl -sN -H "$H" $B/devices/$D/events &                     # SSE: online/offline/status/serial
head -c 300000 /dev/urandom > app.bin
curl -s -X POST -H "$H" -H 'Content-Type: application/octet-stream' \
  -H "X-Image-Sha256: $(shasum -a 256 app.bin | cut -d' ' -f1)" \
  --data-binary @app.bin $B/devices/$D/builds               # → 201 {"buildId":…}
curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d '{"line":"hola"}' $B/devices/$D/input
curl -s -H "$H" $B/builds/<buildId>                         # → {"state":"running"}
```

## Behaviour worth knowing (beyond the protocol text)

- **Unknown device → `404 unknown_device`** on every call except `register`. After a relay restart, TTL expiry or `DELETE`, a board's next poll gets 404 and it re-registers.
- **Token checks are repeated after every wait.** A body upload or long-poll that straddles a `DELETE`, a TTL expiry or a token rotation is answered `404`/`401`, never applied to the record that replaced it. A rotation (`register` with `previousToken`) also ends the device's open SSE streams and long-polls, so the old token gets nothing more.
- **Build states:** `queued` (relay-side, until the board's first status) then the board's `downloading | flashing | rebooting | running | failed`. `running` and `failed` are terminal and final (later status reports for that build answer `204` and change nothing); the image is freed then (`GET …/image` → `410`). A queued build replaced by a newer upload becomes `failed` with `detail: "replaced"`. The 10 min build TTL counts from the last state change.
- **Long-polls:** `?wait=` is whole seconds, clamped to 25, missing = 0. One open poll per device per kind: a newer `next` (or `input`) answers the older one with `204`. A client that disconnects releases its waiter immediately (request abort signal).
- **SSE:** the first event is the current presence (`online`/`offline`), which also flushes headers through proxies (`X-Accel-Buffering: no`). Heartbeat comment every 15 s. `serial` events carry an `id`; reconnecting with `Last-Event-ID` replays the missed lines from the 500-line ring. Browsers' `EventSource` cannot send `Authorization`, so the editor reads the stream with `fetch()` + a stream reader. A client more than 1000 events behind is dropped at once (it reconnects with `Last-Event-ID`); a stream closed by the server (DELETE, rotation, expiry) flushes queued events for at most 5 s.
- **Online** = any authenticated device call in the last 60 s; `offline` events come from a 5 s sweep.
- **Rate limits** (per device, counted only after the token checks out, so a wrong-token flood cannot lock a board out): control 60/min, serial 150/min, builds 10/h → `429` + `Retry-After`. Editor `input` is not rate-limited; the queue keeps the last 100 lines.
- **Bodies:** image ≤ 2 MB (rejected from `Content-Length` before reading, or as soon as a chunked body crosses it), serial ≤ 8 kB / 50 lines, other JSON ≤ 2 kB. All images in memory, plus space reserved by uploads still being read, are capped at 192 MB → `503` + `Retry-After`.
- **Logs:** one JSON object per line on stdout: method, path, status, ms, device/build ids. Never headers, tokens or bodies.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `RELAY_ALLOWED_ORIGINS` | unset = `*` | Comma-separated editor origins for CORS. Auth is a bearer token, never a cookie, so `*` leaks nothing, but set it in production (a warning is logged when unset and `NODE_ENV=production`). |

## Docker

```bash
docker build -t som-relay:dev server/relay
docker run --rm -p 8080:8080 som-relay:dev
curl -s http://127.0.0.1:8080/healthz      # {"ok":true}
```

Runs as the image's unprivileged `node` user with production dependencies only.

## Deploy (Fly.io)

From `server/relay/`:

```bash
fly launch --copy-config --no-deploy   # first time only: creates som-relay from fly.toml
fly secrets set RELAY_ALLOWED_ORIGINS=https://<editor-origin>   # or [env] in fly.toml
fly deploy
curl -s https://som-relay.fly.dev/healthz
```

State is in memory, so: one machine, `auto_stop_machines = "off"`, `min_machines_running = 1`. A deploy or restart drops device records (boards re-register on their next poll) and queued builds (the editor sees `404` on `GET /v1/builds/{id}` and re-posts once, per the protocol). Do not scale to two machines without replacing `MemoryStore` and the in-process `Hub`.

## Known limits

- No per-IP limit on unauthenticated calls; a register flood for random MACs is bounded only by the 10 000-device cap.
- The `Store` interface is synchronous by design (single machine; a synchronous SQLite driver fits it). The `Hub` (wake-ups, SSE fan-out) stays in-process either way.
