/**
 * Agent tool `pay_for_resource` (docs/05 "Agent tool contract"), x402 v2 wire format via @x402/core/http.
 *
 * Both agents use this same client WITHOUT a spending limit by default: that is the V12 finding (Oct 2026) about
 * the pre-Aug-18 default x402 client. The leashed agent is still safe because the vault, not the client, decides.
 * Pass `maxPrice` to get the modern client-side refusal behaviour.
 */
import { PublicKey } from "@solana/web3.js";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { fromBaseUnits, fromHex } from "@leash/sdk";
import type { DemoPayment } from "@leash/sdk/demo";
import type { WalletBackend } from "./wallets";

export interface PayForResourceArgs {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** base units; undefined = no client-side limit (pre-Aug-18 default client behaviour) */
  maxPrice?: bigint;
  /** the agent's stated reason for paying */
  reason: string;
}

export interface PayForResourceResult {
  status: "ok" | "blocked" | "pending_approval" | "refused" | "failed";
  httpStatus?: number;
  data?: unknown;
  requirement?: PaymentRequirements;
  paymentRequired?: PaymentRequired;
  payment?: DemoPayment;
  settle?: SettleResponse;
  paidTxSig?: string;
  blockedReason?: string;
  blinkUrl?: string;
  error?: string;
}

/** Leashed agents pay with the custom "leash" scheme; the victim's hot wallet uses a plain transfer. */
function pickRequirement(pr: PaymentRequired, backend: WalletBackend): PaymentRequirements | undefined {
  const want = backend.mode === "leashed" ? "leash" : "transfer";
  return pr.accepts.find((a) => a.scheme === want);
}

async function request(args: PayForResourceArgs, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(args.url, {
    method: args.method ?? "GET",
    headers: { Accept: "application/json", ...(args.body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Pending co-signed payments: request PDA -> what to retry once the owner approves. */
export interface PendingX402 {
  args: PayForResourceArgs;
  paymentRequired: PaymentRequired;
  accepted: PaymentRequirements;
  nonce: string;
  request: string;
  createdAt: number;
}
export const pendingX402 = new Map<string, PendingX402>();

export async function payForResource(args: PayForResourceArgs, backend: WalletBackend): Promise<PayForResourceResult> {
  let first: Response;
  try {
    first = await request(args);
  } catch (e) {
    return { status: "failed", error: `Can't reach ${new URL(args.url).origin} (${(e as Error).message}). Start it: pnpm --filter x402-servers dev` };
  }
  if (first.status !== 402) {
    return { status: first.ok ? "ok" : "failed", httpStatus: first.status, data: await readJson(first) };
  }

  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) return { status: "failed", httpStatus: 402, error: "402 without a PAYMENT-REQUIRED header" };
  const paymentRequired = decodePaymentRequiredHeader(header);
  const accepted = pickRequirement(paymentRequired, backend);
  if (!accepted) return { status: "failed", httpStatus: 402, paymentRequired, error: "No payment scheme this wallet can use" };

  const amount = BigInt(accepted.amount);
  if (args.maxPrice !== undefined && amount > args.maxPrice) {
    return { status: "refused", httpStatus: 402, requirement: accepted, paymentRequired, error: `Price ${fromBaseUnits(amount)} is above maxPrice ${fromBaseUnits(args.maxPrice)}` };
  }

  const nonce = String(accepted.extra?.nonce ?? "");
  const payment = await backend.pay({
    to: new PublicKey(accepted.payTo),
    toLabel: paymentRequired.resource?.serviceName ?? new URL(args.url).pathname,
    amount,
    reason: args.reason,
    memo: /^[0-9a-f]{64}$/i.test(nonce) ? fromHex(nonce) : undefined,
    memoText: nonce ? `x402:${nonce}` : undefined,
  });

  if (payment.status === "pending_approval" && payment.request) {
    pendingX402.set(payment.request, { args, paymentRequired, accepted, nonce, request: payment.request, createdAt: Date.now() });
    return { status: "pending_approval", httpStatus: 402, requirement: accepted, paymentRequired, payment, blinkUrl: payment.blinkUrl };
  }
  if (payment.status !== "executed" || !payment.sig) {
    return {
      status: payment.status === "blocked" ? "blocked" : "failed",
      httpStatus: 402,
      requirement: accepted,
      paymentRequired,
      payment,
      blockedReason: payment.friendly ? `${payment.errorName ?? ""} ${payment.friendly.title}`.trim() : payment.errorName,
    };
  }
  return retryWithProof(args, paymentRequired, accepted, nonce, payment.sig, payment);
}

/** Retry the original request with PAYMENT-SIGNATURE carrying the onchain proof. */
export async function retryWithProof(
  args: PayForResourceArgs,
  paymentRequired: PaymentRequired,
  accepted: PaymentRequirements,
  nonce: string,
  txSignature: string,
  payment?: DemoPayment,
  extraPayload: Record<string, unknown> = {},
): Promise<PayForResourceResult> {
  const proof = encodePaymentSignatureHeader({
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: { txSignature, nonce, ...extraPayload },
  });
  // The leash verifier reads the confirmed tx; give the RPC a moment if it isn't indexed yet.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await request(args, { "PAYMENT-SIGNATURE": proof });
    if (res.status !== 402) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const settleHeader = res!.headers.get("PAYMENT-RESPONSE");
  const settle = settleHeader ? decodePaymentResponseHeader(settleHeader) : undefined;
  const data = await readJson(res!);
  if (!res!.ok) {
    return { status: "failed", httpStatus: res!.status, requirement: accepted, paymentRequired, payment, paidTxSig: txSignature, data, error: `Server rejected the payment proof (${res!.status})` };
  }
  return { status: "ok", httpStatus: res!.status, data, requirement: accepted, paymentRequired, payment, settle, paidTxSig: txSignature };
}
