/**
 * Rate limits and budgets behind one small async interface, so the in-memory store used today can be swapped for
 * a shared one (Upstash / Vercel KV) without touching the routes: a KV store implements `hit` as
 * `INCRBY key cost` + `PEXPIRE key windowMs NX`, then compares the count with `limit`.
 *
 * In-memory caveat: each server instance counts on its own, and a restart resets the counts. That is fine for the
 * single-process demo; serverless hosting needs the KV store (see rateLimitStore()).
 */
export interface RateLimitResult {
  allowed: boolean;
  /** hits in the current window, including this one */
  count: number;
  limit: number;
  /** seconds until the window resets (0 when allowed) */
  retryAfterSecs: number;
}

export interface RateLimitStore {
  /** Count `cost` hits for `key` in a fixed window of `windowMs`; denied once the count exceeds `limit`. */
  hit(key: string, limit: number, windowMs: number, cost?: number): Promise<RateLimitResult>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maxKeys = 50_000) {}

  async hit(key: string, limit: number, windowMs: number, cost = 1): Promise<RateLimitResult> {
    const now = Date.now();
    if (this.windows.size >= this.maxKeys) this.sweep(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
    }
    w.count += cost;
    const allowed = w.count <= limit;
    return { allowed, count: w.count, limit, retryAfterSecs: allowed ? 0 : Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }

  get size(): number {
    return this.windows.size;
  }

  private sweep(now: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    // still full (a flood of distinct keys): drop the oldest windows
    for (const k of this.windows.keys()) {
      if (this.windows.size < this.maxKeys * 0.9) break;
      this.windows.delete(k);
    }
  }
}

const g = globalThis as unknown as { __leashRateLimitStore?: RateLimitStore };

/** The store every route uses. Swap point for a shared KV implementation. */
export function rateLimitStore(): RateLimitStore {
  return (g.__leashRateLimitStore ??= new MemoryRateLimitStore());
}

/** "2026-11-06": key suffix for daily budgets (UTC). */
export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Positive integer from env, or the fallback. */
export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
