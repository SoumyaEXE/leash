/**
 * x402 v2 paywall middleware (docs/05). Headers: PAYMENT-REQUIRED (402, base64 JSON), PAYMENT-SIGNATURE (client
 * proof), PAYMENT-RESPONSE (settlement). Encoded/decoded with @x402/core/http so the wire format is the real v2 one.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PublicKey } from "@solana/web3.js";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { PAYMENT_REQUIRED_CACHE_CONTROL } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { fromBaseUnits } from "@leash/sdk";
import { cfg, setupGaps } from "./config";
import { type IssuedTerms, consume, issue, lookup, sigUsed } from "./nonces";
import { exactRequirementEnabled, verifyAndSettleExact } from "./verify/exact-facilitator";
import { verifyLeashPayment } from "./verify/leash";
import { verifyTransferPayment } from "./verify/transfer";
import type { Verdict } from "./verify/tx";

export interface PaidRoute {
  serviceName: string;
  description: string;
  /** seconds the payment terms stay valid (co-signed payments need minutes, not seconds) */
  ttlSecs: number;
  price(req: Request): Promise<{ amount: bigint; payTo: PublicKey }>;
}

export interface PaymentInfo {
  scheme: string;
  txSignature: string;
  amount: string;
  payTo: string;
  payer?: string;
  detail: string;
}

function resourceKey(req: Request): string {
  return `${req.method} ${req.baseUrl}${req.path}`;
}

function requirements(terms: IssuedTerms): PaymentRequirements[] {
  const common = {
    network: cfg.network,
    asset: terms.asset,
    amount: terms.amount.toString(),
    payTo: terms.payTo,
    maxTimeoutSeconds: terms.expiresAt - terms.issuedAt,
  };
  const out: PaymentRequirements[] = [
    { scheme: "leash", ...common, extra: { nonce: terms.nonce, program: cfg.programId?.toBase58(), decimals: 6, symbol: "dUSDC" } },
    { scheme: "transfer", ...common, extra: { nonce: terms.nonce, decimals: 6, symbol: "dUSDC", memo: `x402:${terms.nonce}` } },
  ];
  if (exactRequirementEnabled()) out.push({ scheme: "exact", ...common, extra: { nonce: terms.nonce } });
  return out;
}

async function send402(req: Request, res: Response, route: PaidRoute, error?: string): Promise<void> {
  const { amount, payTo } = await route.price(req);
  const terms = issue(
    { resource: resourceKey(req), amount, payTo: payTo.toBase58(), asset: cfg.mint!.toBase58(), schemes: ["leash", "transfer"] },
    route.ttlSecs,
  );
  const body: PaymentRequired = {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: `${cfg.publicUrl}${req.originalUrl}`,
      description: route.description,
      mimeType: "application/json",
      serviceName: route.serviceName,
    },
    accepts: requirements(terms),
  };
  res.status(402);
  res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body));
  res.setHeader("Cache-Control", PAYMENT_REQUIRED_CACHE_CONTROL);
  res.json({ ...body, _human: `Pay ${fromBaseUnits(amount)} dUSDC to ${payTo.toBase58()} and retry with PAYMENT-SIGNATURE.` });
}

export function paywall(route: PaidRoute): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gaps = setupGaps();
      if (gaps.length) {
        res.status(503).json({ error: `x402 server not configured. Missing in .env: ${gaps.join(", ")} (run pnpm setup:devnet)` });
        return;
      }
      const header = req.get("PAYMENT-SIGNATURE");
      if (!header) return void (await send402(req, res, route));

      let payload: PaymentPayload;
      try {
        payload = decodePaymentSignatureHeader(header);
      } catch {
        return void (await send402(req, res, route, "Malformed PAYMENT-SIGNATURE header"));
      }
      const scheme = payload.accepted?.scheme;
      const nonce = String(payload.payload?.nonce ?? payload.accepted?.extra?.nonce ?? "");
      const sig = String(payload.payload?.txSignature ?? "");
      const terms = lookup(nonce);
      const now = Math.floor(Date.now() / 1000);
      if (!terms) return void (await send402(req, res, route, "Unknown payment nonce"));
      if (terms.resource !== resourceKey(req)) return void (await send402(req, res, route, "Nonce was issued for a different resource"));
      if (terms.usedBy) return void (await send402(req, res, route, "Nonce already used"));
      if (now > terms.expiresAt) return void (await send402(req, res, route, "Payment terms expired"));
      if (scheme !== "exact" && (!sig || sigUsed(sig))) return void (await send402(req, res, route, "Missing or reused transaction signature"));

      let verdict: Verdict & { transaction?: string };
      if (scheme === "leash" && process.env.X402_ACCEPT_MOCK === "1" && sig.startsWith("mock")) {
        // DEV ONLY: lets the UI exercise S4 against the agent's MockLeashClient before the program is deployed.
        verdict = { ok: true, detail: "MOCK payment accepted (X402_ACCEPT_MOCK=1, never enable in a real run)" };
      } else if (scheme === "leash") {
        verdict = await verifyLeashPayment(sig, terms, { request: payload.payload?.request as string | undefined });
      } else if (scheme === "transfer") {
        verdict = await verifyTransferPayment(sig, terms);
      } else if (scheme === "exact") {
        verdict = await verifyAndSettleExact(payload, requirements(terms).find((r) => r.scheme === "exact")!);
      } else {
        verdict = { ok: false, reason: `Unsupported scheme "${scheme}"` };
      }
      if (!verdict.ok) {
        // let the client retry the same proof while the tx confirms; otherwise re-issue terms
        res.status(402);
        if (verdict.retryable) {
          res.json({ x402Version: 2, error: verdict.reason, retryable: true });
          return;
        }
        return void (await send402(req, res, route, verdict.reason));
      }
      const txSignature = verdict.transaction ?? sig;
      consume(terms, txSignature);
      res.setHeader(
        "PAYMENT-RESPONSE",
        encodePaymentResponseHeader({ success: true, transaction: txSignature, network: cfg.network, payer: verdict.payer, amount: terms.amount.toString() }),
      );
      res.locals.payment = {
        scheme,
        txSignature,
        amount: fromBaseUnits(terms.amount),
        payTo: terms.payTo,
        payer: verdict.payer,
        detail: verdict.detail,
      } satisfies PaymentInfo;
      next();
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  };
}
