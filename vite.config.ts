import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { blocklyMedia } from './vite.blockly-media';

// PWA setup follows vite-pwa/vite-plugin-pwa examples/assets-generator (generateSW + autoUpdate).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    blocklyMedia(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'SoM Blocks',
        short_name: 'SoM Blocks',
        lang: 'es',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#0e7490',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the app shell built by Vite (incl. Blockly's media), so editing works
        // offline.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}', 'blockly-media/*'],
        cleanupOutdatedCaches: true,
        // No runtimeCaching on purpose: compile-server responses (POST /v3/compile and
        // the /v3/info/* lookups) must always hit the network and never be served from
        // a cache. Runtime caching rules for static third-party assets come in a later PR;
        // any rule added then must exclude the compile-server origin.
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Blockly changes only on upgrades: keep it (and its es/en UI messages) in their own
        // long-cached chunks so app deploys don't re-download them.
        codeSplitting: {
          groups: [
            { name: 'blockly-msg', test: /node_modules[\\/].*blockly[\\/]msg[\\/]/, priority: 2 },
            { name: 'blockly', test: /node_modules[\\/].*blockly[\\/]/, priority: 1 },
          ],
        },
      },
    },
    // The Blockly chunk alone is above Vite's 500 kB default; the editor can't work
    // without it, so lazy-loading would only add a spinner. Warn if anything grows past it.
    chunkSizeWarningLimit: 700,
  },
});
