/**
 * Live devnet check of the x402 payment path with payer binding, against the DEPLOYED Leash program and an x402
 * server you start yourself. Spends real devnet dUSDC from the demo vault (0.05, plus 0.25 with --cosign).
 *
 *   X402_SERVER_PORT=4221 X402_SERVER_URL=http://localhost:4221 pnpm --filter x402-servers start   # terminal 1
 *   X402_SERVER_URL=http://localhost:4221 pnpm --filter agent exec tsx test/live-x402.ts [--cosign] [--victim] [--skip-market]
 *
 * Checks: a front-runner presenting the agent's tx with their own authorization is refused; a proof without an
 * authorization is refused; the agent's own proof is accepted; replay is refused. --cosign: the owner's public
 * approval tx can't be redeemed by anyone but the vault's agent (not even the owner's key), and the agent's proof
 * is accepted. --victim: the plain-transfer path (skipped when the victim wallet is empty).
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { LeashClient, fromBaseUnits, fromHex } from "@leash/sdk";
import { connection, settings } from "../src/env";
import { getLeash } from "../src/leash";
import { LeashedWallet, VictimWallet, type WalletBackend } from "../src/wallets";
import { payerAuthorization, retryWithProof } from "../src/x402-client";

const s = settings();
const BASE = s.x402Url;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function terms(path: string, method: "GET" | "POST", scheme: string): Promise<{ pr: PaymentRequired; accepted: PaymentRequirements; nonce: string }> {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  if (r.status !== 402) throw new Error(`${path}: expected 402, got ${r.status}`);
  const pr = decodePaymentRequiredHeader(r.headers.get("PAYMENT-REQUIRED")!);
  await r.arrayBuffer();
  const accepted = pr.accepts.find((a) => a.scheme === scheme)!;
  return { pr, accepted, nonce: String(accepted.extra.nonce) };
}

async function present(path: string, method: "GET" | "POST", pr: PaymentRequired, accepted: PaymentRequirements, payload: Record<string, unknown>) {
  const header = encodePaymentSignatureHeader({ x402Version: 2, resource: pr.resource, accepted, payload });
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": header },
    body: method === "POST" ? "{}" : undefined,
  });
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  return { status: r.status, error: body.error ?? "" };
}

async function pay(backend: WalletBackend, accepted: PaymentRequirements, nonce: string, reason: string) {
  return backend.pay({
    to: new PublicKey(accepted.payTo),
    amount: BigInt(accepted.amount),
    reason,
    memo: fromHex(nonce),
    memoText: `x402:${nonce}`,
  });
}

async function leashedMarket(): Promise<void> {
  console.log("\n— leash scheme: GET /api/market/SOL —");
  const path = "/api/market/SOL";
  const { pr, accepted, nonce } = await terms(path, "GET", "leash");
  const p = await pay(new LeashedWallet(), accepted, nonce, "x402: Market Data API, SOL quote ($0.05) [offchain-security live check]");
  check("vault paid through the Leash program", p.status === "executed" && !!p.sig, `${p.status} ${p.errorName ?? ""} ${p.sig ?? ""}`);
  if (!p.sig || p.status !== "executed") return;
  await new Promise((r) => setTimeout(r, 2000));

  const thief = Keypair.generate();
  const stolen = await present(path, "GET", pr, accepted, { txSignature: p.sig, nonce, ...payerAuthorization(thief, nonce, pr.resource!.url) });
  check("front-runner with the agent's tx is refused", stolen.status === 402 && /was signed by/.test(stolen.error), stolen.error);

  const bare = await present(path, "GET", pr, accepted, { txSignature: p.sig, nonce });
  check("proof without payer authorization is refused", bare.status === 402 && /Missing payer authorization/.test(bare.error), bare.error);

  const own = await retryWithProof({ url: `${BASE}${path}`, reason: "x" }, pr, accepted, nonce, p.sig, p);
  check("agent's own proof is accepted", own.status === "ok" && own.httpStatus === 200, `${own.status} ${own.httpStatus} ${own.error ?? ""}`);

  const replay = await present(path, "GET", pr, accepted, { txSignature: p.sig, nonce, ...payerAuthorization(s.agent!, nonce, pr.resource!.url) });
  check("replay of the redeemed proof is refused", replay.status === 402 && /already used/.test(replay.error), replay.error);
}

async function cosignedResearch(): Promise<void> {
  console.log("\n— leash scheme, co-signed: POST /api/research —");
  const path = "/api/research";
  const { pr, accepted, nonce } = await terms(path, "POST", "leash");
  const p = await pay(new LeashedWallet(), accepted, nonce, "x402: Research API summary ($0.25) [offchain-security live check]");
  check("over the co-sign line: request created", p.status === "pending_approval" && !!p.request, `${p.status} ${p.errorName ?? ""}`);
  if (!p.request) return;
  if (!s.owner) return check("owner key available to approve", false, "keys/owner.json missing");
  const { vault } = getLeash();
  const owner = new LeashClient({ connection: connection(), programId: s.programId!, wallet: s.owner });
  const approveSig = await owner.ownerAction({ type: "approveRequest", vault, request: new PublicKey(p.request) });
  check("owner approved", !!approveSig, approveSig);
  await new Promise((r) => setTimeout(r, 2000));

  // The approval tx is signed by the owner and public; the deployed program copies the request's memo (= nonce)
  // into SpendExecuted, so the payment is bound to this nonce. Who may redeem it is the vault's agent only.
  const stolen = await present(path, "POST", pr, accepted, {
    txSignature: approveSig,
    nonce,
    request: p.request,
    ...payerAuthorization(Keypair.generate(), nonce, pr.resource!.url),
  });
  check("front-runner with the owner's approval tx is refused", stolen.status === 402 && /was signed by/.test(stolen.error), stolen.error);
  const ownerSigned = await present(path, "POST", pr, accepted, {
    txSignature: approveSig,
    nonce,
    request: p.request,
    ...payerAuthorization(s.owner, nonce, pr.resource!.url),
  });
  check("even the owner's key can't redeem it (payer must be the vault's agent)", ownerSigned.status === 402 && /was signed by/.test(ownerSigned.error), ownerSigned.error);

  const ok = await retryWithProof({ url: `${BASE}${path}`, method: "POST", body: {}, reason: "x" }, pr, accepted, nonce, approveSig, undefined, { request: p.request });
  check("co-signed proof with its request account is accepted", ok.status === "ok", `${ok.status} ${ok.httpStatus} ${ok.error ?? ""}`);
}

async function victimTransfer(): Promise<void> {
  console.log("\n— transfer scheme (victim hot wallet): GET /api/market/SOL —");
  const victim = new VictimWallet(s.victim!, s.mint);
  const bal = await victim.balance();
  if (bal < 50_000n) return console.log(`skip: victim wallet has ${fromBaseUnits(bal)} dUSDC (run pnpm reset:demo)`);
  const path = "/api/market/SOL";
  const { pr, accepted, nonce } = await terms(path, "GET", "transfer");
  const p = await pay(victim, accepted, nonce, "x402 market");
  check("victim paid with a plain transfer", p.status === "executed" && !!p.sig, p.status);
  if (!p.sig) return;
  await new Promise((r) => setTimeout(r, 2000));
  const stolen = await present(path, "GET", pr, accepted, { txSignature: p.sig, nonce, ...payerAuthorization(Keypair.generate(), nonce, pr.resource!.url) });
  check("front-runner refused (transfer)", stolen.status === 402 && /was signed by/.test(stolen.error), stolen.error);
  const own = await retryWithProof({ url: `${BASE}${path}`, reason: "x" }, pr, accepted, nonce, p.sig, p);
  check("victim's own proof accepted (transfer)", own.status === "ok", `${own.status} ${own.error ?? ""}`);
}

if (getLeash().kind !== "real") throw new Error("Needs the real Leash client: LEASH_PROGRAM_ID, DUSDC_MINT and keys/agent.json");
if (!process.argv.includes("--skip-market")) await leashedMarket();
if (process.argv.includes("--cosign")) await cosignedResearch();
if (process.argv.includes("--victim")) await victimTransfer();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall live checks passed");
process.exit(failures ? 1 : 0);
