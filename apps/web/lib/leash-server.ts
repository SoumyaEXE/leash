import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import type { ILeashClient } from "@leash/sdk";
import { createLeashClient, type LeashWallet } from "./leash";

// Bump when the client implementation changes so dev hot reloads don't keep a stale singleton.
const CLIENT_VERSION = "3";
const g = globalThis as unknown as { __leashServer?: { v: string; c: ILeashClient }; __leashConn?: Connection };

export function serverConnection(): Connection {
  if (!g.__leashConn) {
    g.__leashConn = new Connection(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  }
  return g.__leashConn;
}

/** The Arena's agent key (holds only fee SOL). Loaded from AGENT_KEYPAIR_PATH relative to the repo root. */
export function loadAgentWallet(): Keypair | undefined {
  // Hosted deploys (no keys/ folder): AGENT_SECRET_KEY = the JSON byte array of the agent keypair.
  if (process.env.AGENT_SECRET_KEY) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.AGENT_SECRET_KEY)));
    } catch {
      return undefined;
    }
  }
  const rel = process.env.AGENT_KEYPAIR_PATH || "keys/agent.json";
  const p = resolve(/*turbopackIgnore: true*/ process.cwd(), "../..", rel);
  if (!existsSync(p)) return undefined;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export type { LeashWallet };

/** Server singleton (survives dev hot reloads). Uses the agent key so Arena spends are signed by the agent. */
export function serverLeashClient(): ILeashClient {
  if (!g.__leashServer || g.__leashServer.v !== CLIENT_VERSION) {
    g.__leashServer = { v: CLIENT_VERSION, c: createLeashClient(serverConnection(), loadAgentWallet()) };
  }
  return g.__leashServer.c;
}
