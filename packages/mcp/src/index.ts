
/**
 * @leash/mcp — any MCP agent gets a leashed Solana wallet in one line:
 *   claude mcp add leash -- node packages/mcp/dist/index.js
 *
 * The agent can *ask* to pay. The Leash program decides. Refusals come back as results (with the onchain error
 * name and an explorer link), never as exceptions, so the model can explain them to its user.
 *
 * Env (read from the repo-root .env or the MCP client's env block):
 *   SOLANA_RPC_URL, LEASH_PROGRAM_ID, LEASH_VAULT, AGENT_KEYPAIR_PATH, NEXT_PUBLIC_SITE_URL (for Blink links)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { z } from "zod";
import { LeashClient, fromBaseUnits, fromHex, toBaseUnits, type SpendResult } from "@leash/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
loadEnv({ path: resolve(ROOT, ".env"), quiet: true });

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (repo .env or the MCP client's env block)`);
  return v;
}

function loadAgent(): Keypair {
  const p = process.env.AGENT_KEYPAIR_PATH ?? "keys/agent.json";
  const path = isAbsolute(p) ? p : resolve(ROOT, p);
  if (!existsSync(path)) throw new Error(`Agent keypair not found at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const agent = loadAgent();
const vault = new PublicKey(required("LEASH_VAULT"));
const leash = new LeashClient({
  connection,
  programId: required("LEASH_PROGRAM_ID"),
  wallet: agent,
  blinkBaseUrl: process.env.NEXT_PUBLIC_SITE_URL,
});

type Json = Record<string, unknown>;
const result = (data: Json) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

function spendSummary(r: SpendResult, extra: Json = {}): Json {
  return r.ok
    ? { status: "paid", signature: r.sig, explorer: r.explorerUrl, authorizedBy: r.via, ...extra }
    : {
        status: r.blocked ? "blocked_onchain" : "failed",
        error: r.name,
        why: r.friendly.detail,
        explorer: r.explorerUrl,
        note: r.blocked ? "The Leash program refused this payment. Only the vault owner can authorize new payees or larger amounts." : undefined,
        ...extra,
      };
}

/** Pay, and fall back to an owner co-sign request when the amount needs one. */
async function payOrRequest(payee: PublicKey, amount: bigint, reason: string, memo?: Uint8Array): Promise<Json> {
  const r = await leash.spend({ vault, payee, amount, reason, memo, expectFailure: true });
  if (!r.ok && r.name === "RequiresCosign") {
    const req = await leash.requestSpend({ vault, payee, amount, reason, memo });
    if (req.ok) {
      return {
        status: "pending_owner_approval",
        request: req.request.toBase58(),
        approveUrl: req.blinkUrl,
        explorer: req.explorerUrl,
        note: "Above the co-sign threshold. The owner approves with one tap (Solana Action / Blink); nothing moves until then.",
      };
    }
    return spendSummary(req);
  }
  return spendSummary(r);
}

const server = new McpServer({ name: "leash", version: "0.1.0" });

server.registerTool(
  "leash_balance",
  {
    title: "Leash vault status",
    description:
      "Balance of the agent's Leash vault (dUSDC on Solana devnet), remaining caps for today, and the owner-approved payees with their budgets.",
    inputSchema: z.object({}),
  },
  async () => {
    const v = await leash.getVault(vault);
    const payees = await leash.listPayees(vault);
    const now = Math.floor(Date.now() / 1000);
    const usedToday = now - v.windowStart >= 86_400 ? 0n : v.spentInWindow;
    return result({
      vault: vault.toBase58(),
      balance: fromBaseUnits(v.balance),
      paused: v.paused,
      perPaymentCap: fromBaseUnits(v.perTxCap),
      leftToday: fromBaseUnits(v.dailyCap > usedToday ? v.dailyCap - usedToday : 0n),
      cosignAbove: v.cosignThreshold === 0n ? null : fromBaseUnits(v.cosignThreshold),
      payees: payees.map((p) => ({
        label: p.label,
        address: p.payee.toBase58(),
        active: p.active,
        perPaymentMax: fromBaseUnits(p.perTxMax),
        budgetLeft: p.budgetTotal === 0n ? "unlimited" : fromBaseUnits(p.budgetTotal - p.spent),
      })),
    });
  },
);

server.registerTool(
  "leash_pay",
  {
    title: "Pay through Leash",
    description:
      "Ask the Leash vault to pay `amount` dUSDC to `payee`. Succeeds only for owner-approved payees within budget; large amounts become an owner approval request. A refusal is returned with its onchain error, not thrown.",
    inputSchema: z.object({
      payee: z.string().describe("recipient wallet address (base58)"),
      amount: z.string().describe('amount in dUSDC, e.g. "0.05"'),
      reason: z.string().max(180).describe("why you are paying; recorded onchain next to the payment"),
    }),
  },
  async ({ payee, amount, reason }) => result(await payOrRequest(new PublicKey(payee), toBaseUnits(amount), reason)),
);

server.registerTool(
  "leash_request",
  {
    title: "Request owner approval",
    description: "Create a pending payment the vault owner can approve with a Solana Action (Blink). Nothing moves until they sign.",
    inputSchema: z.object({
      payee: z.string(),
      amount: z.string(),
      reason: z.string().max(180),
    }),
  },
  async ({ payee, amount, reason }) => {
    const r = await leash.requestSpend({ vault, payee: new PublicKey(payee), amount: toBaseUnits(amount), reason });
    return result(
      r.ok
        ? { status: "pending_owner_approval", request: r.request.toBase58(), approveUrl: r.blinkUrl, explorer: r.explorerUrl }
        : spendSummary(r),
    );
  },
);

server.registerTool(
  "leash_pay_for_resource",
  {
    title: "Pay for an x402 resource through Leash",
    description:
      "Fetch a URL; if it answers HTTP 402 (x402 v2), pay with the vault (scheme 'leash') and retry with the payment proof. Refuses anything above maxPrice before asking the vault, and the vault still enforces per-service budgets.",
    inputSchema: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]).default("GET"),
      body: z.record(z.string(), z.unknown()).optional(),
      maxPrice: z.string().describe('max dUSDC you are willing to pay, e.g. "0.10"'),
      reason: z.string().max(180).default("x402 resource"),
    }),
  },
  async ({ url, method, body, maxPrice, reason }) => {
    const send = (headers: Record<string, string> = {}) =>
      fetch(url, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    const first = await send();
    if (first.status !== 402) return result({ status: first.ok ? "ok" : "http_error", httpStatus: first.status, data: await first.text() });
    const header = first.headers.get("PAYMENT-REQUIRED");
    if (!header) return result({ status: "failed", error: "402 without a PAYMENT-REQUIRED header" });
    const pr = decodePaymentRequiredHeader(header);
    const accepted = pr.accepts.find((a) => a.scheme === "leash");
    if (!accepted) return result({ status: "failed", error: "Server offers no 'leash' payment scheme", offered: pr.accepts.map((a) => a.scheme) });
    const amount = BigInt(accepted.amount);
    if (amount > toBaseUnits(maxPrice)) {
      return result({ status: "refused_by_client", price: fromBaseUnits(amount), maxPrice, payTo: accepted.payTo });
    }
    const nonce = String(accepted.extra?.nonce ?? "");
    const memo = /^[0-9a-f]{64}$/i.test(nonce) ? fromHex(nonce) : undefined;
    const paid = await payOrRequest(new PublicKey(accepted.payTo), amount, reason, memo);
    if (paid.status !== "paid") return result({ ...paid, price: fromBaseUnits(amount), payTo: accepted.payTo });
    const proof = encodePaymentSignatureHeader({
      x402Version: 2,
      resource: pr.resource,
      accepted,
      payload: { txSignature: String(paid.signature), nonce },
    });
    let res = await send({ "PAYMENT-SIGNATURE": proof });
    for (let i = 0; i < 3 && res.status === 402; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await send({ "PAYMENT-SIGNATURE": proof });
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // plain text resource
    }
    return result({ status: res.ok ? "ok" : "payment_rejected_by_server", httpStatus: res.status, paid: fromBaseUnits(amount), ...paid, data });
  },
);

await server.connect(new StdioServerTransport());
console.error(`leash-mcp ready · vault ${vault.toBase58()} · agent ${agent.publicKey.toBase58()}`);
