export type BodyResult = { ok: true; bytes: Buffer } | { ok: false; reason: 'too_large' };

/**
 * Reads a request body, refusing anything over `max` bytes before buffering it:
 * a declared `Content-Length` over the limit is rejected without reading, and a chunked
 * body is cancelled as soon as the running total crosses the limit.
 */
export async function readLimited(req: Request, max: number): Promise<BodyResult> {
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n > max) return { ok: false, reason: 'too_large' };
  }
  if (!req.body) return { ok: true, bytes: Buffer.alloc(0) };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}
