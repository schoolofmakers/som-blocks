import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

// Serves Blockly's media (sprites, cursors, sounds) from our own origin under
// `blockly-media/`, matching BLOCKLY_MEDIA_URL in src/blocks/BlocklyWorkspace.tsx. Without an
// explicit `media` option Blockly would load them from a third-party CDN, which breaks
// offline editing. Pattern: google/blockly-samples examples/blockly-rtc (media served from
// the app's own `media/` path), automated here instead of a manual copy step.

export const BLOCKLY_MEDIA_DIR = 'blockly-media';

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.cur': 'image/x-icon',
};

function blocklyMediaSource(): string {
  const require = createRequire(import.meta.url);
  // blockly's exports map doesn't expose package.json; resolve the CJS entry instead.
  return path.join(path.dirname(require.resolve('blockly')), 'media');
}

export function blocklyMedia(): Plugin {
  const source = blocklyMediaSource();
  const files = new Set(readdirSync(source));

  return {
    name: 'som-blocks:blockly-media',
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${BLOCKLY_MEDIA_DIR}`, (req, res, next) => {
        // Only exact file names from the media folder; anything else falls through.
        const name = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\//, '');
        if (!files.has(name)) return next();
        res.setHeader(
          'Content-Type',
          CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream',
        );
        res.end(readFileSync(path.join(source, name)));
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${BLOCKLY_MEDIA_DIR}/${name}`,
          source: readFileSync(path.join(source, name)),
        });
      }
    },
  };
}
