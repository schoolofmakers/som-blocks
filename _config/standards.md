# Standards — som-blocks

## Stack
- Vite + React 18 + TypeScript (strict) + Blockly 13.x, built as an installable PWA (works offline for editing; compile needs network). Tailwind for styling, Zustand for app state, Dexie for IndexedDB, Vitest + Playwright for tests. pnpm. Same shape as som-classcoach's web app so the team moves between repos without relearning.
- Mobile is a first-class target (Android Chrome tablets/phones): touch-friendly Blockly config, responsive layout, and a `Transport` abstraction so the board link can be Web Serial (desktop), Web Bluetooth (Android + desktop) or, later, a Capacitor BLE bridge for iOS. See `_config/architecture.md` → Transports.
- Static deploy (editor) + one Docker compile server (`server/`) on Fly.io. No backend of our own in v1; projects persist in IndexedDB in the browser.
- Licence MIT. **Never copy code from Hello Blocks' recovered source** (Academia de Inventores copyright) or from DuinoApp (GPL-3.0). Patterns and the HTTP contract are fine; code is not. Dependencies must be MIT/Apache/BSD/ISC.

## Code
- One block family = one module exporting `{ blocks, generators, toolbox, messages }`. Generators produce Arduino C++ through the shared `ArduinoGenerator` (includes / definitions / setup / loop sections). No family reaches into another family's state.
- Boards are data (`_config/boards.md` → `src/boards/*.ts`): fqbn, upload tool, pin profile, USB vendor/product IDs, baud. Adding a board must not require code changes outside that registry.
- Every user-visible string goes through i18n keys (`_config/i18n.md`). No hardcoded Spanish or English in components or block definitions.
- Browser-only hardware access: Web Serial (`navigator.serial`). Feature-detect and show a clear message on unsupported browsers (Safari/Firefox).
- Errors from the compile server are shown verbatim in a log panel; the UI never swallows arduino-cli output.

## Quality gates (per PR)
- `pnpm typecheck && pnpm test && pnpm build` green in CI.
- Generator changes ship with golden tests: a workspace JSON fixture → expected `.ino` text.
- Flasher changes ship with evidence from a real board (serial log, photo or short video) in the PR description.
- Student-facing copy reviewed for age 10–14 reading level, in both languages.

## Never
- Never store student personal data in v1 (no accounts, no names sent anywhere). Accounts are v2 and get their own privacy review.
- Never make the editor depend on the compile server being online for editing, saving or exporting code.
- Never hide compiler errors behind a generic message.
