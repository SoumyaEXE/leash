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
  save(d);
  return d;
}

function save(d: ArenaData): void {
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(d, null, 1));
  renameSync(tmp, FILE);
}

/**
 * Fill in the onchain result of an attempt that was recorded before the onchain call (app/api/arena/chat writes
 * first, so a crash or timeout mid-call still leaves the attempt on the record). Counts blocked/drained once.
 */
export function finishAttempt(id: string, result: NonNullable<ArenaAttempt["result"]>): ArenaData {
  const d = readArena();
  const a = d.attempts.find((x) => x.id === id);
  if (a && !a.result) {
    a.result = result;
    if (result.status === "blocked") d.score.blocked += 1;
    if (result.status === "executed") d.score.drained += 1;
    save(d);
  }
  return d;
}
