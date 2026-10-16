import process from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the PWA plugin stays out of unit tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // `pnpm test:golden:update` rewrites the golden .ino files (src/blocks/__golden__).
    update: process.env.UPDATE_GOLDEN === '1',
  },
});
