import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(ROOT, ".env"), quiet: true });

export function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

export function envPubkey(name: string): PublicKey | null {
  const v = env(name);
  if (!v) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

export function keypairFromPath(relOrAbs: string): Keypair | null {
  const p = isAbsolute(relOrAbs) ? relOrAbs : resolve(ROOT, relOrAbs);
  if (!existsSync(p)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) {
    conn = new Connection(env("SOLANA_RPC_URL", "https://api.devnet.solana.com"), {
      commitment: "confirmed",
      wsEndpoint: env("SOLANA_WS_URL") || undefined,
    });
  }
  return conn;
}

/** Everything the demo needs, resolved once. Missing values are null so callers can explain what to set up. */
export function settings() {
  return {
    rpcUrl: env("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    programId: envPubkey("LEASH_PROGRAM_ID"),
    mint: envPubkey("DUSDC_MINT"),
    vault: envPubkey("LEASH_VAULT"),
    attacker: envPubkey("ATTACKER_PUBKEY"),
    merchant: envPubkey("MERCHANT_PUBKEY"),
    owner: keypairFromPath(env("OWNER_KEYPAIR_PATH", "keys/owner.json")),
    agent: keypairFromPath(env("AGENT_KEYPAIR_PATH", "keys/agent.json")),
    victim: keypairFromPath(env("VICTIM_KEYPAIR_PATH", "keys/victim.json")),
    x402Url: env("X402_SERVER_URL", "http://localhost:4021"),
    siteUrl: env("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
    port: Number(env("AGENT_SERVER_PORT", "4020")),
    allowOfflineFallback: env("LLM_OFFLINE_FALLBACK") === "1",
    forceMock: env("LEASH_USE_MOCK") === "1",
  };
}

export type Settings = ReturnType<typeof settings>;

/** Human-readable list of what's missing for live devnet runs. */
export function devnetGaps(s: Settings): string[] {
  const gaps: string[] = [];
  if (!s.mint) gaps.push("DUSDC_MINT (run: pnpm setup:devnet)");
  if (!s.attacker) gaps.push("ATTACKER_PUBKEY (run: pnpm --filter scripts keys)");
  if (!s.merchant) gaps.push("MERCHANT_PUBKEY (run: pnpm --filter scripts keys)");
  if (!s.victim) gaps.push("keys/victim.json");
  if (!s.agent) gaps.push("keys/agent.json");
  return gaps;
}
