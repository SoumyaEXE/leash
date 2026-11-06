import "server-only";

const g = globalThis as unknown as { __leashRl?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__leashRl ??= new Map<string, number[]>());

/** Sliding window: at most `limit` hits per `windowMs` per key. Returns seconds to wait, or 0 if allowed. */
export function rateLimit(key: string, limit = 10, windowMs = 10 * 60_000): number {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return Math.ceil((windowMs - (now - list[0])) / 1000);
  }
  list.push(now);
  hits.set(key, list);
  return 0;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
}
