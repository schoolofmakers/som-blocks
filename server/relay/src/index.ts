import { serve } from '@hono/node-server';
import { createRelay } from './app.js';
import { parseAllowedOrigins } from './config.js';
import { jsonLogger } from './log.js';

const SWEEP_MS = 5_000;

const log = jsonLogger();
const port = Number(process.env.PORT ?? 8080);
const allowedOrigins = parseAllowedOrigins(process.env.RELAY_ALLOWED_ORIGINS);
if (allowedOrigins === '*' && process.env.NODE_ENV === 'production') {
  log.warn('RELAY_ALLOWED_ORIGINS unset: CORS allows any origin');
}

const relay = createRelay({ config: { allowedOrigins }, logger: log });
const sweeper = setInterval(relay.sweep, SWEEP_MS);

const server = serve({ fetch: relay.app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  log.info('listening', { port: info.port, origins: String(allowedOrigins) });
});

const shutdown = (signal: string) => {
  log.info('shutting down', { signal });
  clearInterval(sweeper);
  // Answer every long-poll (204) and end SSE streams so `close` is not held open.
  relay.hub.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
