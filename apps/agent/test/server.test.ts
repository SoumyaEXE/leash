/**
 * Agent server exposure: loopback-only by default and the optional AGENT_TOKEN gate on /run* and /reset.
 * Spawns the real server (mock Leash client, port 4220/4222) and only sends requests that fail validation after
 * the auth check, so nothing touches devnet. Run: pnpm --filter agent test
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const AGENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(port: number, extraEnv: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: AGENT_DIR,
    env: { ...process.env, AGENT_SERVER_PORT: String(port), LEASH_USE_MOCK: "1", HOST: "", AGENT_TOKEN: "", ...extraEnv },
    stdio: "ignore",
  });
}

async function waitUp(url: string): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`server at ${url} never came up`);
}

const lanAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("agent server with AGENT_TOKEN", () => {
  const PORT = 4220;
  const BASE = `http://127.0.0.1:${PORT}`;
  let child: ChildProcess;
  before(async () => {
    child = start(PORT, { AGENT_TOKEN: "test-token-123" });
    await waitUp(`${BASE}/health`);
  });
  after(() => {
    child.kill();
  });

  it("answers on IPv4 and IPv6 loopback", async () => {
    assert.equal((await fetch(`${BASE}/health`)).status, 200);
    const v6 = await fetch(`http://[::1]:${PORT}/health`).catch(() => null);
    if (v6) assert.equal(v6.status, 200);
  });

  it("is not reachable on the LAN address", async () => {
    const lan = lanAddress();
    if (!lan) return;
    const r = await fetch(`http://${lan}:${PORT}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    assert.equal(r, null, `expected no listener on ${lan}:${PORT}`);
  });

  it("rejects /run, /run-split and /reset without the token", async () => {
    for (const path of ["/run", "/run-split", "/reset"]) {
      const r = await post(`${BASE}${path}`, {});
      assert.equal(r.status, 401, path);
    }
    assert.equal((await post(`${BASE}/run`, {}, { Authorization: "Bearer wrong-token" })).status, 401);
    assert.equal((await post(`${BASE}/run`, {}, { Authorization: "Bearer test-token-12" })).status, 401);
  });

  it("lets the right token through to validation", async () => {
    const r = await post(`${BASE}/run`, { scenario: "nope" }, { Authorization: "Bearer test-token-123" });
    assert.equal(r.status, 400);
  });

  it("keeps read endpoints open", async () => {
    assert.equal((await fetch(`${BASE}/health`)).status, 200);
  });
});

describe("agent server without a token (local demo)", () => {
  const PORT = 4222;
  const BASE = `http://127.0.0.1:${PORT}`;
  let child: ChildProcess;
  before(async () => {
    child = start(PORT, {});
    await waitUp(`${BASE}/health`);
  });
  after(() => {
    child.kill();
  });

  it("needs no Authorization header", async () => {
    const r = await post(`${BASE}/run`, { scenario: "nope" });
    assert.equal(r.status, 400);
  });

  it("allows the dashboard origin to send Authorization in CORS preflight", async () => {
    const r = await fetch(`${BASE}/run`, { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
    assert.equal(r.status, 204);
    assert.match(r.headers.get("access-control-allow-headers") ?? "", /Authorization/);
  });
});
