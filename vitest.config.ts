import process from 'node:process';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Vitest's on-disk module cache (`fsModuleCache`, node_modules/.vitest-cache) keys a module by
// its own source. A module that uses `import.meta.glob` (the golden harness) transforms to a
// list of the files that matched *when it was cached*, so a newly added fixture stayed
// invisible until `vitest --clearCache`. Never cache those modules: the glob is re-expanded
// on every run. The fixture files themselves are still cached (by their own content).
const noCacheForImportMetaGlob: Plugin = {
  name: 'som:no-fs-cache-for-import-meta-glob',
  configureVitest({ defineCacheKeyGenerator }) {
    defineCacheKeyGenerator(({ sourceCode }) =>
      sourceCode.includes('import.meta.glob') ? false : undefined,
    );
  },
};

// Kept separate from vite.config.ts so the PWA plugin stays out of unit tests.
export default defineConfig({
  plugins: [react(), noCacheForImportMetaGlob],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // `pnpm test:golden:update` rewrites the golden .ino files (src/blocks/__golden__).
    update: process.env.UPDATE_GOLDEN === '1',
  },
});
