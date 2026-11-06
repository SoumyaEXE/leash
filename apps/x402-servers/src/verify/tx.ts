import type { TokenBalance, VersionedTransactionResponse } from "@solana/web3.js";
import { connection } from "../config";

export type Verdict = { ok: true; payer?: string; detail: string } | { ok: false; reason: string; retryable?: boolean };

export async function fetchTx(sig: string): Promise<VersionedTransactionResponse | null> {
  return connection().getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
}

function total(list: TokenBalance[] | null | undefined, owner: string, mint: string): bigint {
  let t = 0n;
  for (const b of list ?? []) if (b.owner === owner && b.mint === mint) t += BigInt(b.uiTokenAmount.amount);
  return t;
}

/** Net change of `owner`'s balance of `mint` in this tx, from pre/post token balances (works for PDA owners too). */
export function tokenDelta(tx: VersionedTransactionResponse, owner: string, mint: string): bigint {
  return total(tx.meta?.postTokenBalances, owner, mint) - total(tx.meta?.preTokenBalances, owner, mint);
}

/** The owner whose balance of `mint` dropped the most (the payer). */
export function debitedOwner(tx: VersionedTransactionResponse, mint: string): string | undefined {
  const pre = new Map<number, TokenBalance>();
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.mint === mint) pre.set(b.accountIndex, b);
  let best: { owner?: string; drop: bigint } | undefined;
  for (const b of tx.meta?.postTokenBalances ?? []) {
    const p = pre.get(b.accountIndex);
    if (!p || b.mint !== mint) continue;
    const drop = BigInt(p.uiTokenAmount.amount) - BigInt(b.uiTokenAmount.amount);
    if (drop > 0n && (!best || drop > best.drop)) best = { owner: b.owner ?? p.owner, drop };
  }
  return best?.owner;
}
