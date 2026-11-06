import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { DEVNET_CAIP2 } from "@leash/sdk";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(ROOT, ".env"), quiet: true });

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function pk(name: string): PublicKey | null {
  try {
    return env(name) ? new PublicKey(env(name)) : null;
  } catch {
    return null;
  }
}

export const cfg = {
  port: Number(env("X402_SERVER_PORT", "4021")),
  publicUrl: env("X402_SERVER_URL", `http://localhost:${env("X402_SERVER_PORT", "4021")}`),
  network: DEVNET_CAIP2 as `${string}:${string}`,
  mint: pk("DUSDC_MINT"),
  merchant: pk("MERCHANT_PUBKEY"),
  /** payTo of the research API: its own payee, so it gets its own onchain budget */
  research: pk("RESEARCH_PUBKEY"),
  attacker: pk("ATTACKER_PUBKEY"),
  programId: pk("LEASH_PROGRAM_ID"),
  facilitatorUrl: env("X402_FACILITATOR_URL"),
  rpcUrl: env("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
};

let conn: Connection | null = null;
export function connection(): Connection {
  conn ??= new Connection(cfg.rpcUrl, "confirmed");
  return conn;
}

export function setupGaps(): string[] {
  const g: string[] = [];
  if (!cfg.mint) g.push("DUSDC_MINT");
  if (!cfg.merchant) g.push("MERCHANT_PUBKEY");
  if (!cfg.attacker) g.push("ATTACKER_PUBKEY");
  if (!cfg.programId) g.push("LEASH_PROGRAM_ID");
  return g;
}
