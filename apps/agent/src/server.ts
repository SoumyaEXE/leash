/**
 * Demo runner HTTP API for apps/web (/demo buttons). Wire contract: packages/sdk/src/demo.ts
 *   GET  /health · GET /balances · POST /run {mode, scenario} · POST /run-split {scenario} · POST /reset
 * Extras (additive): GET /requests/:request (co-sign progress, S4) · GET /activity (Leash activity feed)
 */
import express, { type NextFunction, type Request, type Response } from "express";
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

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

app.post("/run", async (req, res) => {
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

app.post("/run-split", async (req, res) => {
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

app.post("/reset", async (_req, res) => {
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
app.listen(s.port, () => {
  console.log(`Leash demo agents on http://localhost:${s.port} (Leash client: ${getLeash().kind}, x402: ${s.x402Url})`);
});
