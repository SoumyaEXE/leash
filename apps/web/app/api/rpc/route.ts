/**
 * Browser → Solana JSON-RPC proxy. The upstream URL (Helius, with its API key) lives only in the server env
 * (SOLANA_RPC_URL), so the key never ships to visitors. Only the methods the app uses are forwarded.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MAX_BODY = 64 * 1024;

const ALLOWED = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getVersion",
  "getGenesisHash",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "isBlockhashValid",
  "simulateTransaction",
  "sendTransaction",
]);

type RpcReq = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

function deny(id: unknown, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } };
}

export async function POST(req: Request): Promise<Response> {
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json(deny(null, "Request too large"), { status: 413 });
  let body: RpcReq | RpcReq[];
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(deny(null, "Invalid JSON"), { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 10) return Response.json(deny(null, "Batch too large"), { status: 413 });
  const blocked = calls.find((c) => !c.method || !ALLOWED.has(c.method));
  if (blocked) return Response.json(deny(blocked.id, `Method not allowed: ${blocked.method}`), { status: 403 });

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
