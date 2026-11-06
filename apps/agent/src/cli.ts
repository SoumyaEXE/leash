/**
 * pnpm --filter agent demo:victim  --scenario s1
 * pnpm --filter agent demo:leashed --scenario s1
 * pnpm --filter agent demo:split   --scenario s5 [--variant merchant]
 * pnpm --filter agent demo:legit
 * pnpm --filter agent reset
 */
import type { DemoMode, DemoRunResult, ScenarioId } from "@leash/sdk/demo";
import { SCENARIOS } from "@leash/sdk/demo";
import { getLeash } from "./leash";
import { resetDemo } from "./reset";
import { runScenario } from "./scenarios";

const C = { red: "\x1b[31m", green: "\x1b[32m", amber: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function print(r: DemoRunResult): void {
  const title = r.mode === "victim" ? "UNPROTECTED AGENT" : "LEASHED AGENT";
  console.log(`\n${C.bold}━━ ${title} · ${r.scenario.toUpperCase()} ${SCENARIOS[r.scenario].title} ━━${C.reset}`);
  for (const st of r.steps) {
    const color = st.kind === "error" ? C.red : st.kind === "payment" ? C.bold : st.kind === "model" ? C.amber : C.dim;
    console.log(`${C.dim}${String(st.t).padStart(6)}ms${C.reset} ${color}${st.label}:${C.reset} ${st.text}`);
  }
  for (const p of r.payments) {
    const color = p.status === "executed" ? (r.mode === "victim" && /attacker|drainer/i.test(p.toLabel ?? "") ? C.red : C.green) : p.status === "blocked" ? C.red : C.amber;
    const tag = p.status === "blocked" ? `⛔ BLOCKED ONCHAIN: ${p.errorName}` : p.status === "executed" ? "✅ executed" : p.status === "pending_approval" ? "⏳ pending owner co-sign" : `✖ ${p.status}`;
    console.log(`${color}${tag}${C.reset}  ${p.amount} dUSDC → ${p.toLabel ?? p.to}`);
    if (p.explorerUrl) console.log(`   explorer: ${p.explorerUrl}`);
    if (p.blinkUrl) console.log(`   blink:    ${p.blinkUrl}`);
  }
  console.log(`${C.dim}balance ${r.balanceBefore} → ${r.balanceAfter} dUSDC · ${r.durationMs} ms${C.reset}`);
  if (r.error) console.log(`${C.red}error: ${r.error}${C.reset}`);
}

async function main(): Promise<number> {
  const cmd = process.argv[2] as DemoMode | "split" | "reset";
  const scenario = (arg("scenario", "s1") as ScenarioId) ?? "s1";
  const variant = arg("variant") === "merchant" ? "merchant" : undefined;
  if (!["s1", "s2", "s4", "s5"].includes(scenario)) throw new Error(`Unknown scenario ${scenario}`);
  console.log(`${C.dim}Leash client: ${getLeash().kind}${C.reset}`);

  if (cmd === "reset") {
    const r = await resetDemo();
    r.log.forEach((l) => console.log(l));
    return r.ok ? 0 : 1;
  }
  if (cmd === "split") {
    const [v, l] = await Promise.all([runScenario("victim", scenario, { variant }), runScenario("leashed", scenario, { variant })]);
    print(v);
    print(l);
    return v.ok && l.ok ? 0 : 1;
  }
  if (cmd === "victim" || cmd === "leashed") {
    const r = await runScenario(cmd, scenario, { variant });
    print(r);
    return r.ok ? 0 : 1;
  }
  throw new Error("usage: cli.ts victim|leashed|split|reset [--scenario s1|s2|s4|s5] [--variant merchant]");
}

// Let sockets drain instead of process.exit(): on Windows, exiting while fetch keep-alive handles close trips a
// libuv assertion. The unref'd timer only fires if something keeps the loop alive.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 8000).unref());
