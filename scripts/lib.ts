import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = resolve(ROOT, ".env");
loadEnv({ path: ENV_PATH });

export const KEY_NAMES = ["owner", "agent", "victim", "attacker", "merchant", "research", "leash-program"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

export function keyPath(name: KeyName): string {
  return resolve(ROOT, "keys", `${name}.json`);
}

export function loadKeypair(name: KeyName): Keypair {
  const p = keyPath(name);
  if (!existsSync(p)) throw new Error(`Missing keypair ${p}. Run: pnpm --filter scripts keys`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export function loadOrCreateKeypair(name: KeyName): { kp: Keypair; created: boolean } {
  const p = keyPath(name);
  if (existsSync(p)) return { kp: loadKeypair(name), created: false };
  mkdirSync(dirname(p), { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return { kp, created: true };
}

export function connection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", {
    commitment: "confirmed",
    wsEndpoint: process.env.SOLANA_WS_URL,
  });
}

/** Set KEY=value lines in .env, keeping every other line (and comments) as they are. */
export function setEnv(values: Record<string, string>): void {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    const line = `${k}=${v}`;
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
    process.env[k] = v;
  }
  writeFileSync(ENV_PATH, text);
}

export function envPubkey(name: string): PublicKey {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return new PublicKey(v);
}
