/**
 * Same-origin proxy to the demo runner (apps/agent) for hosted deploys: the agent server stays private (loopback or
 * a private network, AGENT_TOKEN set) and this route adds the bearer token server-side, so the token never reaches
 * the browser. Point the dashboard at it with NEXT_PUBLIC_AGENT_SERVER_URL=/api/agent. The local demo doesn't need
 * it (the browser talks to http://localhost:4020 directly).
 *
 * Only the runner's own endpoints are forwarded, and runs/resets are rate limited per visitor.
 */
import { clientIp } from "../../_lib/client-ip";
import { envInt, rateLimitStore } from "../../_lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = (process.env.AGENT_SERVER_URL || "http://127.0.0.1:4020").replace(/\/$/, "");
const MAX_BODY = 4 * 1024;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Ctx = { params: Promise<{ path?: string[] }> };

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function allowedGet(path: string[]): boolean {
  const [a, b, ...rest] = path;
  if (rest.length) return false;
  if (!b) return a === "health" || a === "balances" || a === "activity";
  return a === "requests" && BASE58.test(b);
}

const POSTS = new Set(["run", "run-split", "reset"]);

async function forward(method: "GET" | "POST", path: string[], body?: string): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (process.env.AGENT_TOKEN) headers.Authorization = `Bearer ${process.env.AGENT_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${UPSTREAM}/${path.join("/")}`, { method, headers, body, cache: "no-store" });
  } catch {
    return json({ error: "The demo agent server is unreachable." }, 502);
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const path = (await ctx.params).path ?? [];
  if (!allowedGet(path)) return json({ error: "Not found" }, 404);
  return forward("GET", path);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const path = (await ctx.params).path ?? [];
  if (path.length !== 1 || !POSTS.has(path[0])) return json({ error: "Not found" }, 404);
  const body = await req.text();
  if (body.length > MAX_BODY) return json({ error: "Request too large" }, 413);
  const limit = envInt("AGENT_PROXY_RUNS_PER_10MIN", 20);
  const hit = await rateLimitStore().hit(`agent:ip:${clientIp(req)}`, limit, 10 * 60_000);
  if (!hit.allowed) {
    return json({ error: `Rate limit: ${limit} demo runs per 10 minutes. Try again in ${hit.retryAfterSecs}s.` }, 429, {
      "Retry-After": String(hit.retryAfterSecs),
    });
  }
  return forward("POST", path, body || "{}");
}
