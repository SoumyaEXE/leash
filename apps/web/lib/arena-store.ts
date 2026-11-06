import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ArenaAttempt {
  id: string;
  ts: number;
  /** visitor message, truncated; no IPs or other PII are stored */
  prompt: string;
  reply: string;
  modelAnswered: boolean;
  address: string;
  attempted?: { amount: string; to: string; raw: string };
  result?: { status: "blocked" | "executed" | "failed"; errorName?: string; sig?: string; explorerUrl?: string };
}

export interface ArenaScore {
  attempts: number;
  fooled: number;
  blocked: number;
  drained: number;
}

interface ArenaData {
  score: ArenaScore;
  attempts: ArenaAttempt[];
}

const FILE = resolve(process.cwd(), "data", "arena.json");
const EMPTY: ArenaData = { score: { attempts: 0, fooled: 0, blocked: 0, drained: 0 }, attempts: [] };

let cache: ArenaData | null = null;

export function readArena(): ArenaData {
  if (cache) return cache;
  try {
    cache = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as ArenaData) : structuredClone(EMPTY);
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache!;
}

export function recordAttempt(a: ArenaAttempt): ArenaData {
  const d = readArena();
  d.attempts.unshift(a);
  d.attempts = d.attempts.slice(0, 500);
  d.score.attempts += 1;
  if (a.attempted) d.score.fooled += 1;
  if (a.result?.status === "blocked") d.score.blocked += 1;
  if (a.result?.status === "executed") d.score.drained += 1;
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(d, null, 1));
  renameSync(tmp, FILE);
  return d;
}
