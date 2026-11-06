/** Decoding Leash program events from transaction logs (via @leash/sdk). */
import { parseLeashEvents } from "@leash/sdk";
import { cfg } from "./config";

export interface SpendExecutedEvent {
  vault: string;
  payee: string;
  amount: bigint;
  memo: Uint8Array | null;
  via: string;
  ts: number;
}

/**
 * SpendExecuted events emitted by the Leash program in these logs. Only events emitted while the Leash program
 * itself is executing count, so another program in the same tx can't forge one.
 * Returns null when LEASH_PROGRAM_ID isn't configured.
 */
export function spendExecutedEvents(logs: readonly string[]): SpendExecutedEvent[] | null {
  if (!cfg.programId) return null;
  const out: SpendExecutedEvent[] = [];
  for (const e of parseLeashEvents(logs, cfg.programId)) {
    if (e.name !== "SpendExecuted") continue;
    out.push({
      vault: e.data.vault.toBase58(),
      payee: e.data.payee.toBase58(),
      amount: e.data.amount,
      memo: e.data.memo,
      via: e.data.via,
      ts: e.data.ts,
    });
  }
  return out;
}
