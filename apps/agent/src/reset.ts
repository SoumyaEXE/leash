import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env";
import { getLeash, resetLeashHandle } from "./leash";
import { MockLeashClient } from "./leash-mock";

/** Restore the seeded demo state. Delegates to scripts/reset-demo.ts (owner keys live there), plus mock state. */
export async function resetDemo(): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = [];
  const leash = getLeash();
  if (leash.client instanceof MockLeashClient) {
    leash.client.resetDemo();
    log.push("Mock vault restored to 1,000 dUSDC (mock Leash client).");
  }
  const script = resolve(ROOT, "scripts", "reset-demo.ts");
  if (!existsSync(script)) {
    log.push("TODO: scripts/reset-demo.ts doesn't exist yet; onchain balances were not reset.");
    return { ok: leash.kind === "mock", log };
  }
  const ok = await new Promise<boolean>((done) => {
    // Run the script directly with Node + tsx (no shell, no nested pnpm, stdin closed): spawning `pnpm` through a
    // shell with an open stdin pipe never exited on Windows, so /reset hung.
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      cwd: resolve(ROOT, "scripts"),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      log.push("reset timed out after 120 s");
      child.kill();
    }, 120_000);
    const onData = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) log.push(line.trim());
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      log.push(`spawn failed: ${e.message}`);
      done(false);
    });
  });
  resetLeashHandle();
  return { ok, log: log.slice(-60) };
}
