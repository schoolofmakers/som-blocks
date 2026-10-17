import { createHash, timingSafeEqual } from 'node:crypto';

/** Pairing tokens are 32 random bytes as hex (64 chars); accept ≥ 32 hex chars, bounded. */
const TOKEN_RE = /^[0-9a-fA-F]{32,128}$/;

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** The raw token from `Authorization: Bearer <token>`, or null when missing/malformed. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return isWellFormedToken(token) ? token : null;
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Constant-time comparison of sha256(token) against a stored hash. */
export function tokenMatches(storedHash: Buffer, token: string): boolean {
  const candidate = hashToken(token);
  return candidate.length === storedHash.length && timingSafeEqual(candidate, storedHash);
}
