export interface RelayConfig {
  /** CORS: `'*'` or an exact list of editor origins. */
  allowedOrigins: '*' | string[];
  /** A device is online when its last call is at most this old. */
  onlineWindowMs: number;
  buildTtlMs: number;
  deviceTtlMs: number;
  serialRingLines: number;
  inputQueueLines: number;
  /** Upper bound for `?wait=` on the device long-polls, seconds. */
  maxWaitSec: number;
  sseHeartbeatMs: number;
  /** SSE events queued for one slow editor before its stream is dropped. */
  sseMaxBacklog: number;
  maxImageBytes: number;
  /** Cap on images held in memory across all devices; over it new builds get 503. */
  maxTotalImageBytes: number;
  maxSerialBodyBytes: number;
  maxSerialLines: number;
  maxJsonBodyBytes: number;
  maxInputLineChars: number;
  limits: {
    control: { limit: number; windowMs: number };
    serial: { limit: number; windowMs: number };
    builds: { limit: number; windowMs: number };
  };
}

const MINUTE = 60_000;

export const defaultConfig: RelayConfig = {
  allowedOrigins: '*',
  onlineWindowMs: MINUTE,
  buildTtlMs: 10 * MINUTE,
  deviceTtlMs: 24 * 60 * MINUTE,
  serialRingLines: 500,
  inputQueueLines: 100,
  maxWaitSec: 25,
  sseHeartbeatMs: 15_000,
  sseMaxBacklog: 1000,
  maxImageBytes: 2 * 1024 * 1024,
  maxTotalImageBytes: 192 * 1024 * 1024,
  maxSerialBodyBytes: 8 * 1024,
  maxSerialLines: 50,
  maxJsonBodyBytes: 2 * 1024,
  maxInputLineChars: 1024,
  limits: {
    control: { limit: 60, windowMs: MINUTE },
    serial: { limit: 150, windowMs: MINUTE },
    builds: { limit: 10, windowMs: 60 * MINUTE },
  },
};

/** `RELAY_ALLOWED_ORIGINS="https://a.example,https://b.example"`; unset or `*` → any origin. */
export function parseAllowedOrigins(raw: string | undefined): '*' | string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0 || list.includes('*')) return '*';
  return list;
}
