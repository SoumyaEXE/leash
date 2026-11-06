/**
 * Browser → Solana JSON-RPC proxy. The upstream URL (Helius, with its API key) lives only in the server env
 * (SOLANA_RPC_URL), so the key never ships to visitors. What gets forwarded is decided in ../_lib/rpc-guard.ts:
 * the read methods the app uses, getProgramAccounts scoped to one Leash vault, and send/simulate only for
 * transactions that call the Leash program. Every visitor is rate limited (platform IP header only), and a daily
 * call counter logs a quota alarm (RPC_DAILY_ALARM) and can hard-stop at RPC_DAILY_MAX.
 */
import { programId } from "@/lib/leash";
import { clientIp } from "../_lib/client-ip";
import { DAY_MS, envInt, rateLimitStore, utcDay } from "../_lib/rate-limit";
import { type RpcCall, callCost, checkRpcCall } from "../_lib/rpc-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 10;

function deny(id: unknown, message: string, code = -32601) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** The id the browser SDK uses (NEXT_PUBLIC_LEASH_PROGRAM_ID) and the server's LEASH_PROGRAM_ID, normally equal. */
function leashProgramIds(): string[] {
  return [...new Set([programId().toBase58(), process.env.LEASH_PROGRAM_ID?.trim()].filter((x): x is string => !!x))];
}

const g = globalThis as unknown as { __leashRpcAlarm?: Set<string> };

/** Logs once per threshold crossed (alarm, 2x alarm, ...) per UTC day. */
function quotaAlarm(day: string, count: number, cost: number): void {
  const alarm = envInt("RPC_DAILY_ALARM", 50_000);
  const before = Math.floor((count - cost) / alarm);
  const after = Math.floor(count / alarm);
  if (after <= before) return;
  const seen = (g.__leashRpcAlarm ??= new Set<string>());
  const key = `${day}:${after}`;
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(`[rpc-proxy] QUOTA ALARM: ${count} upstream RPC calls today (${day} UTC), alarm step ${alarm}. Check the provider dashboard.`);
}

export async function POST(req: Request): Promise<Response> {
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json(deny(null, "Request too large"), { status: 413 });
  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(deny(null, "Invalid JSON", -32700), { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return Response.json(deny(null, "Batch too large"), { status: 413 });
  const pids = leashProgramIds();
  for (const c of calls) {
    const why = checkRpcCall(c ?? {}, pids);
    if (why) return Response.json(deny(c?.id, why), { status: 403 });
  }

  const cost = calls.reduce((n, c) => n + callCost(c), 0);
  const store = rateLimitStore();
  const perMinute = envInt("RPC_RATE_LIMIT_PER_MIN", 600);
  const ip = await store.hit(`rpc:ip:${clientIp(req)}`, perMinute, 60_000, cost);
  if (!ip.allowed) {
    return Response.json(deny(calls[0]?.id, `Rate limit: ${perMinute} RPC calls per minute. Retry in ${ip.retryAfterSecs}s.`, -32005), {
      status: 429,
      headers: { "Retry-After": String(ip.retryAfterSecs) },
    });
  }
  const day = utcDay();
  const daily = await store.hit(`rpc:day:${day}`, envInt("RPC_DAILY_MAX", Number.MAX_SAFE_INTEGER), DAY_MS, cost);
  quotaAlarm(day, daily.count, cost);
  if (!daily.allowed) {
    return Response.json(deny(calls[0]?.id, "The RPC proxy hit its daily quota. Try again tomorrow (UTC).", -32005), { status: 429 });
  }

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
    cache: "no-store",
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
