export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Sliding-log limiter: remembers the timestamps of the last `limit` hits per key.
 * Memory per key is bounded by `limit` (≤ 150 here), keys are per device + bucket.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  hit(key: string, limit: number, windowMs: number): RateResult {
    const now = this.now();
    const log = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (log.length >= limit) {
      this.hits.set(key, log);
      const oldest = log[0] ?? now;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }
    log.push(now);
    this.hits.set(key, log);
    return { ok: true };
  }

  /** Drops keys whose newest hit is older than `maxWindowMs`. */
  sweep(maxWindowMs: number) {
    const cutoff = this.now() - maxWindowMs;
    for (const [key, log] of this.hits) {
      const newest = log[log.length - 1];
      if (newest === undefined || newest <= cutoff) this.hits.delete(key);
    }
  }

  /** Drops every key that starts with `prefix` (a deleted device). */
  forget(prefix: string) {
    for (const key of this.hits.keys()) if (key.startsWith(prefix)) this.hits.delete(key);
  }
}
