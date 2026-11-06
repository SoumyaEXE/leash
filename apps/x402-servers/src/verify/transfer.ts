/**
 * "transfer" scheme: a plain SPL TransferChecked the client broadcast itself, with an SPL Memo "x402:<nonce>".
 * This is how the unprotected victim agent pays: a hot wallet signing whatever the API asks for.
 */
import type { IssuedTerms } from "../nonces";
import { type Verdict, debitedOwner, fetchTx, tokenDelta } from "./tx";

export async function verifyTransferPayment(sig: string, terms: IssuedTerms): Promise<Verdict> {
  const tx = await fetchTx(sig);
  if (!tx) return { ok: false, reason: "Transaction not found (not confirmed yet?)", retryable: true };
  if (tx.meta?.err) return { ok: false, reason: `Transaction failed onchain: ${JSON.stringify(tx.meta.err)}` };
  const logs = tx.meta?.logMessages ?? [];
  if (!logs.some((l) => l.includes(`x402:${terms.nonce}`))) return { ok: false, reason: "Memo with the payment nonce not found" };
  const delta = tokenDelta(tx, terms.payTo, terms.asset);
  if (delta < terms.amount) return { ok: false, reason: `payTo received ${delta}, required ${terms.amount}` };
  if (tx.blockTime && tx.blockTime < terms.issuedAt - 5) return { ok: false, reason: "Payment predates these payment terms" };
  return { ok: true, payer: debitedOwner(tx, terms.asset), detail: "verified plain transfer + memo" };
}
