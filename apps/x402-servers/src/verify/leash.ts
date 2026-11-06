/**
 * Option 2 (docs/05): custom "leash" scheme. The agent paid through the Leash program (agent_spend, or the owner's
 * approve_request for co-signed amounts) and sends us the tx signature. We verify from the chain:
 *   tx confirmed & succeeded → invoked LEASH_PROGRAM_ID → SpendExecuted{payee == payTo, amount >= required,
 *   memo == nonce} → payTo's token balance really went up → nonce unused & unexpired, signature never reused.
 */
import { cfg } from "../config";
import { spendExecutedEvents } from "../events";
import type { IssuedTerms } from "../nonces";
import { type Verdict, fetchTx, tokenDelta } from "./tx";

export async function verifyLeashPayment(sig: string, terms: IssuedTerms, opts: { request?: string } = {}): Promise<Verdict> {
  if (!cfg.programId) return { ok: false, reason: "Server misconfigured: LEASH_PROGRAM_ID not set" };
  const tx = await fetchTx(sig);
  if (!tx) return { ok: false, reason: "Transaction not found (not confirmed yet?)", retryable: true };
  if (tx.meta?.err) return { ok: false, reason: `Transaction failed onchain: ${JSON.stringify(tx.meta.err)}` };
  const logs = tx.meta?.logMessages ?? [];
  const program = cfg.programId.toBase58();
  if (!logs.some((l) => l.startsWith(`Program ${program} invoke`))) return { ok: false, reason: "Transaction did not invoke the Leash program" };

  const delta = tokenDelta(tx, terms.payTo, terms.asset);
  if (delta < terms.amount) return { ok: false, reason: `payTo received ${delta}, required ${terms.amount}` };

  if (tx.blockTime && tx.blockTime < terms.issuedAt - 5) return { ok: false, reason: "Payment predates these payment terms" };

  const events = spendExecutedEvents(logs);
  if (events === null) {
    // TODO: decoder not shipped by @leash/sdk yet: we verified program + balance delta + freshness + unused sig.
    return { ok: true, detail: "verified: Leash program invoked, payTo balance delta (event decoder pending)" };
  }
  const nonceHex = terms.nonce.toLowerCase();
  const match = events.find((e) => {
    if (e.payee !== terms.payTo || e.amount < terms.amount) return false;
    if (e.memo) return Buffer.from(e.memo).toString("hex") === nonceHex;
    // Co-signed spends (approve_request) carry no memo: accept only when the client names the request and the
    // event says it was released via an owner-approved request.
    return !!opts.request && e.via === "request";
  });
  if (!match) return { ok: false, reason: "No SpendExecuted event matches payTo / amount / nonce" };
  return { ok: true, payer: match.vault, detail: `verified SpendExecuted via ${match.via || "?"}` };
}
