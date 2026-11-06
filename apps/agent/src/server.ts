/**
 * Demo runner HTTP API for apps/web (/demo buttons). Wire contract: packages/sdk/src/demo.ts
 *   GET  /health · GET /balances · POST /run {mode, scenario} · POST /run-split {scenario} · POST /reset
 * Extras (additive): GET /requests/:request (co-sign progress, S4) · GET /activity (Leash activity feed)
 *
 * Exposure: binds loopback only (127.0.0.1 and ::1) unless HOST is set (e.g. HOST=0.0.0.0 on a hosting box).
 * When AGENT_TOKEN is set, POST /run, /run-split and /reset need "Authorization: Bearer <AGENT_TOKEN>"; the hosted
 * web app adds it server-side through /api/agent/*. With no token (local demo) nothing changes.
 */
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { DemoMode, ScenarioId } from "@leash/sdk/demo";
import { checkRequest, startApprovalWatcher } from "./approvals";
import { getBalances, invalidateBalances } from "./balances";
import { settings } from "./env";
import { getLeash } from "./leash";
import { resetDemo } from "./reset";
import { runScenario } from "./scenarios";

const MODES: DemoMode[] = ["victim", "leashed"];
const SCENARIOS: ScenarioId[] = ["s1", "s2", "s4", "s5"];

const s = settings();
const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000", s.siteUrl.replace(/\/$/, "")]);

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const TOKEN = process.env.AGENT_TOKEN?.trim() ?? "";

/** Bearer-token gate for the endpoints that move money or reset state. No-op when AGENT_TOKEN is unset. */
const requireToken: RequestHandler = (req, res, next) => {
  if (!TOKEN) return next();
  const m = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "");
  const given = Buffer.from(m?.[1]?.trim() ?? "");
  const want = Buffer.from(TOKEN);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="leash-agent"');
    res.status(401).json({ error: "Unauthorized: this agent server needs a bearer token (AGENT_TOKEN)." });
    return;
  }
  next();
};

/** One run per wallet at a time: overlapping devnet transfers from the same wallet confuse the demo. */
const busy = new Set<DemoMode>();
async function exclusive<T>(modes: DemoMode[], fn: () => Promise<T>): Promise<T | null> {
  if (modes.some((m) => busy.has(m))) return null;
  modes.forEach((m) => busy.add(m));
  try {
    return await fn();
  } finally {
    modes.forEach((m) => busy.delete(m));
  }
}

function parseRunBody(body: unknown): { mode?: DemoMode; scenario?: ScenarioId; variant?: "attacker" | "merchant"; error?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const scenario = b.scenario as ScenarioId;
  if (!SCENARIOS.includes(scenario)) return { error: `scenario must be one of ${SCENARIOS.join(", ")}` };
  const variant = b.variant === "merchant" ? "merchant" : undefined;
  if (b.mode === undefined) return { scenario, variant };
  if (!MODES.includes(b.mode as DemoMode)) return { error: `mode must be one of ${MODES.join(", ")}` };
  return { mode: b.mode as DemoMode, scenario, variant };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, leashClient: getLeash().kind });
});

app.get("/balances", async (_req, res) => {
  try {
    res.json(await getBalances());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/run", requireToken, async (req, res) => {
  const p = parseRunBody(req.body);
  if (p.error || !p.mode || !p.scenario) {
    res.status(400).json({ error: p.error ?? "mode is required" });
    return;
  }
  const out = await exclusive([p.mode], () => runScenario(p.mode!, p.scenario!, { variant: p.variant }));
  invalidateBalances();
  if (!out) {
    res.status(409).json({ error: `A ${p.mode} run is already in progress` });
    return;
  }
  res.json(out);
});

app.post("/run-split", requireToken, async (req, res) => {
  const p = parseRunBody(req.body);
  if (p.error || !p.scenario) {
    res.status(400).json({ error: p.error });
    return;
  }
  const out = await exclusive(MODES, async () => {
    const [victim, leashed] = await Promise.all([
      runScenario("victim", p.scenario!, { variant: p.variant }),
      runScenario("leashed", p.scenario!, { variant: p.variant }),
    ]);
    return { victim, leashed };
  });
  invalidateBalances();
  if (!out) {
    res.status(409).json({ error: "A run is already in progress" });
    return;
  }
  res.json(out);
});

app.post("/reset", requireToken, async (_req, res) => {
  const out = await exclusive(MODES, () => resetDemo());
  invalidateBalances();
  if (!out) {
    res.status(409).json({ ok: false, log: ["A run is in progress; try again in a moment."] });
    return;
  }
  res.json(out);
});

app.get("/requests/:request", async (req, res) => {
  res.json(await checkRequest(req.params.request));
});

app.get("/activity", async (_req, res) => {
  const { client, vault } = getLeash();
  const events = await client.recentActivity(vault, 50).catch(() => []);
  res.json(events.map((e) => ({ ...e, amount: e.amount?.toString() })));
});

startApprovalWatcher();

// Loopback by default: the demo runner moves devnet funds and must not be reachable from the LAN.
const HOST = process.env.HOST?.trim();
const hosts = HOST ? [HOST] : ["127.0.0.1", "::1"];
for (const host of hosts) {
  const srv = app.listen(s.port, host, () => {
    if (host !== hosts[0]) return;
    console.log(
      `Leash demo agents on http://${host.includes(":") ? `[${host}]` : host}:${s.port}${HOST ? "" : " (loopback only; set HOST to expose)"} ` +
        `(Leash client: ${getLeash().kind}, x402: ${s.x402Url}${TOKEN ? ", bearer token required for /run* and /reset" : ""})`,
    );
  });
  srv.on("error", (e: NodeJS.ErrnoException) => {
    // no IPv6 loopback on this machine: 127.0.0.1 alone is fine
    if (!HOST && host === "::1" && (e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT")) return;
    console.error(`Agent server failed to listen on ${host}:${s.port}: ${e.message}`);
    process.exit(1);
  });
}
