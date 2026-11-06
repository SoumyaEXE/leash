/**
 * Client IP for rate limiting, taken only from a header the hosting platform sets and a visitor can't forge.
 *
 * - TRUSTED_IP_HEADER=<header>: your platform's header (cf-connecting-ip, fly-client-ip, x-real-ip from your own
 *   nginx, ...). For x-forwarded-for the rightmost entry is used: the one your proxy appended.
 * - On Vercel (VERCEL=1): x-vercel-forwarded-for. Vercel sets it from the TCP connection and overwrites client
 *   values (vercel.com/docs/headers/request-headers).
 * - Otherwise nothing is trusted: a self-hosted `next start` keeps a client-sent X-Forwarded-For as is (Next only
 *   fills it when absent), so every caller shares one bucket. Fine for the local demo; set the header when hosting.
 */
export const UNTRUSTED_IP = "untrusted";

type Env = Record<string, string | undefined>;

export function trustedIpHeader(env: Env = process.env): string | null {
  const h = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (h) return h;
  if (env.VERCEL === "1") return "x-vercel-forwarded-for";
  return null;
}

export function clientIp(req: Request, env: Env = process.env): string {
  const header = trustedIpHeader(env);
  if (!header) return UNTRUSTED_IP;
  const raw = req.headers.get(header);
  if (!raw) return UNTRUSTED_IP;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = header === "x-forwarded-for" ? parts[parts.length - 1] : parts[0];
  return ip ? ip.slice(0, 64) : UNTRUSTED_IP;
}
