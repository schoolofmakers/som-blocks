# som-blocks

Blocks editor for School of Makers classes: Blockly → Arduino C++ → compile server → Web Serial flash. ESP32-C3 SuperMini, Arduino UNO and NANO.

Start at `CLAUDE.md`. Code arrives through the PR plan in `_config/greploop-method.md`.

## Editor development

Requires Node 22 (`.nvmrc`) and pnpm 10 (pinned in `package.json` → `packageManager`; `corepack enable` picks it up).

```
pnpm install
pnpm dev            # Vite dev server on http://localhost:5173 (?lang=en for English)
pnpm lint           # ESLint
pnpm format         # Prettier (write); pnpm format:check in CI
pnpm typecheck      # tsc -b, strict + noUncheckedIndexedAccess
pnpm test           # Vitest unit tests (jsdom)
pnpm build          # typecheck + production build with PWA manifest and service worker into dist/
pnpm preview        # serve dist/
pnpm test:e2e       # Playwright smoke (Chromium) against a fresh build served by `vite preview`
```

First Playwright run: `pnpm exec playwright install chromium` (on Linux/CI: `pnpm exec playwright install chromium --with-deps`).

Placeholder PWA icons are generated with `python3 scripts/make-placeholder-icons.py` (standard library only).

CI (`.github/workflows/ci.yml`) runs install → lint → format check → typecheck → unit tests → build → Playwright smoke on every PR and on pushes to `staging` and `main`.

## Local compile server

Local compile server (until `server/` ships its own image):
```
docker run -d --platform linux/amd64 --name duinoapp-server --restart unless-stopped -p 3030:3030 \
  -e SERVER_INFO_NAME="SoM Compile (local)" -e SERVER_INFO_OWNER="School of Makers" -e SERVER_INFO_COUNTRY=CL \
  duinoapp/duinoapp-server:latest
```
