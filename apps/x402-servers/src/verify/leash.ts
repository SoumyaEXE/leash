/**
 * Option 2 (docs/05): custom "leash" scheme. The agent paid through the Leash program (agent_spend, or the owner's
 * approve_request for co-signed amounts) and sends us the tx signature. We verify from the chain:
 *   tx confirmed & succeeded → invoked LEASH_PROGRAM_ID → payTo's token balance really went up → a SpendExecuted
 *   event (emitted inside the Leash frame) with payee == payTo, amount >= required, and either
 *     - memo == nonce: agent_spend / guarded_spend, and approve_request too (the deployed program copies the
 *       request's memo into SpendExecuted; verified on devnet Nov 6), or
 *     - fallback for a memo-less co-signed event: via == request and the named SpendRequest account (owned by
 *       the program, referenced by this tx) is approved, for this payee/amount, with memo == nonce.
 * The returned `authority` is the vault's agent key read from chain: the paywall requires the payer
 * authorization (payer-auth.ts) to be signed by it.
 */
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { decodeRequest, decodeVault, toHex } from "@leash/sdk";
import { cfg, connection } from "../config";
import { type SpendExecutedEvent, spendExecutedEvents } from "../events";
import type { IssuedTerms } from "../nonces";
import { type Verdict, fetchTx, tokenDelta } from "./tx";

/** Read a Leash-owned account; null when missing or owned by another program. */
async function leashAccount(address: PublicKey): Promise<Buffer | null> {
  const info = await connection().getAccountInfo(address, "confirmed");
  if (!info || !cfg.programId || !info.owner.equals(cfg.programId)) return null;
  return info.data;
}

/** The vault's current agent key, read from chain. */
export async function vaultAgent(vault: string): Promise<string | null> {
  try {
    const data = await leashAccount(new PublicKey(vault));
    return data ? decodeVault(data).agent.toBase58() : null;
  } catch {
    return null;
  }
}

function txAccountKeys(tx: VersionedTransactionResponse): string[] {
  const msg = tx.transaction.message;
  const loaded = tx.meta?.loadedAddresses;
  return [...msg.staticAccountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])].map((k) => k.toBase58());
}

async function matchCosigned(
  tx: VersionedTransactionResponse,
  events: SpendExecutedEvent[],
  requestStr: string,
  terms: IssuedTerms,
): Promise<SpendExecutedEvent | string> {
  let request: PublicKey;
  try {
    request = new PublicKey(requestStr);
  } catch {
    return "Invalid request address";
  }
  if (!txAccountKeys(tx).includes(request.toBase58())) return "Transaction does not reference the named spend request";
  const data = await leashAccount(request);
  if (!data) {
    // v2 closes a SpendRequest when the owner approves it, so the account is gone; the program then binds the payment
    // with SpendExecuted.request and copies the request memo (the nonce) into the event, which the main path checks.
    return "Spend request account is closed (v2 closes it on approval); a co-signed payment must carry the nonce as its memo";
  }
  let r: ReturnType<typeof decodeRequest>;
  try {
    r = decodeRequest(request, data);
  } catch {
    return "Not a Leash spend request";
  }
  if (r.status !== "approved") return `Spend request is ${r.status}, not approved`;
  if (r.payee.toBase58() !== terms.payTo) return "Spend request pays a different payee";
  if (r.amount < terms.amount) return "Spend request amount is below the price";
  if (!r.memo || toHex(r.memo) !== terms.nonce.toLowerCase()) return "Spend request memo does not match this payment nonce";
  const ev = events.find(
    (e) => e.via === "request" && e.vault === r.vault.toBase58() && e.payee === terms.payTo && e.amount === r.amount,
  );
  return ev ?? "No co-signed SpendExecuted event for this request";
}

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

  const events = spendExecutedEvents(logs) ?? [];
  const nonceHex = terms.nonce.toLowerCase();
  let match: SpendExecutedEvent | undefined = events.find(
    (e) => e.payee === terms.payTo && e.amount >= terms.amount && !!e.memo && Buffer.from(e.memo).toString("hex") === nonceHex,
  );
  if (!match && opts.request) {
    const m = await matchCosigned(tx, events, opts.request, terms);
    if (typeof m === "string") return { ok: false, reason: m };
    match = m;
  }
  if (!match) return { ok: false, reason: "No SpendExecuted event matches payTo / amount / nonce" };
  // T10: when the client names the co-signed request, the event must be for that request (v1 logs have no field)
  if (opts.request && match.request && match.request !== opts.request) {
    return { ok: false, reason: "SpendExecuted belongs to a different spend request" };
  }

  const agent = await vaultAgent(match.vault);
  if (!agent) return { ok: false, reason: "Couldn't read the paying vault from chain", retryable: true };
  return { ok: true, payer: match.vault, authority: agent, detail: `verified SpendExecuted via ${match.via || "?"}` };
}
